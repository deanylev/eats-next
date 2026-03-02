'use server';

import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminJwt,
  verifyAdminJwt
} from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  cities,
  countries,
  restaurantAreas,
  restaurantMeals,
  restaurants,
  restaurantToTypes,
  restaurantTypes
} from '@/lib/schema';
import {
  cityInputSchema,
  countryInputSchema,
  parseAreas,
  restaurantInputSchema,
  restaurantTypeInputSchema
} from '@/lib/validators';

const getErrorText = (error: unknown): string => {
  if (error && typeof error === 'object' && 'issues' in error) {
    const maybeIssues = (error as { issues?: Array<{ message?: string }> }).issues;
    if (maybeIssues && maybeIssues.length > 0) {
      return maybeIssues.map((issue) => issue.message ?? 'Validation error').join(' ');
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
};

const isNextRedirectError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (!('digest' in error)) {
    return false;
  }

  return String((error as { digest?: string }).digest ?? '').startsWith('NEXT_REDIRECT');
};

const ADMIN_ERROR_COOKIE = 'admin_error_message';
const ADMIN_SUCCESS_COOKIE = 'admin_success_message';
const ROOT_CREATE_ERROR_COOKIE = 'root_create_error_message';
const ROOT_CREATE_SUCCESS_COOKIE = 'root_create_success_message';
const ROOT_EDIT_ERROR_COOKIE = 'root_edit_error_message';
const ROOT_EDIT_SUCCESS_COOKIE = 'root_edit_success_message';
const ROOT_DELETE_ERROR_COOKIE = 'root_delete_error_message';
const ADMIN_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGIN_ATTEMPTS = 8;
const loginAttemptsByIp = new Map<string, { count: number; firstFailedAt: number; blockedUntil: number }>();

const bounce = (errorMessage: string): never => {
  cookies().set(ADMIN_ERROR_COOKIE, encodeURIComponent(errorMessage), {
    httpOnly: false,
    maxAge: 60,
    path: '/admin',
    sameSite: 'lax'
  });
  redirect('/admin');
};

const requireAdminSession = async (): Promise<void> => {
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? '';
  if (!token) {
    redirect('/admin/login');
  }

  const session = await verifyAdminJwt(token);
  if (!session) {
    cookies().set(ADMIN_SESSION_COOKIE, '', {
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax'
    });
    redirect('/admin/login');
  }
};

const normalizedSha256 = (value: string): Buffer =>
  createHash('sha256').update(value.normalize('NFKC')).digest();

const safeCompare = (left: string, right: string): boolean => {
  const leftHash = normalizedSha256(left);
  const rightHash = normalizedSha256(right);
  return timingSafeEqual(leftHash, rightHash);
};

const getClientIp = (): string => {
  const headerStore = headers();
  const forwardedFor = headerStore.get('x-forwarded-for') ?? '';
  const firstForwarded = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  const realIp = headerStore.get('x-real-ip')?.trim() ?? '';
  return firstForwarded || realIp || 'unknown';
};

const isIpBlocked = (ip: string, now: number): boolean => {
  const record = loginAttemptsByIp.get(ip);
  if (!record) {
    return false;
  }

  if (record.blockedUntil > now) {
    return true;
  }

  if (record.blockedUntil > 0 && record.blockedUntil <= now) {
    loginAttemptsByIp.delete(ip);
  }

  return false;
};

const markLoginFailure = (ip: string, now: number) => {
  const current = loginAttemptsByIp.get(ip);
  if (!current || now - current.firstFailedAt > LOGIN_WINDOW_MS) {
    loginAttemptsByIp.set(ip, {
      count: 1,
      firstFailedAt: now,
      blockedUntil: 0
    });
    return;
  }

  const nextCount = current.count + 1;
  loginAttemptsByIp.set(ip, {
    count: nextCount,
    firstFailedAt: current.firstFailedAt,
    blockedUntil: nextCount >= MAX_FAILED_LOGIN_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0
  });
};

const clearLoginFailures = (ip: string) => {
  loginAttemptsByIp.delete(ip);
};

export const loginAdmin = async (formData: FormData): Promise<void> => {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  const now = Date.now();
  const ip = getClientIp();
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!expectedUsername || !expectedPassword) {
    redirect('/admin/login?error=misconfigured');
  }

  if (isIpBlocked(ip, now)) {
    redirect('/admin/login?error=rate');
  }

  if (!safeCompare(username, expectedUsername) || !safeCompare(password, expectedPassword)) {
    markLoginFailure(ip, now);
    redirect('/admin/login?error=invalid');
  }

  clearLoginFailures(ip);
  const token = await createAdminJwt(username);
  cookies().set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });

  redirect('/admin');
};

export const logoutAdmin = async (): Promise<void> => {
  cookies().set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });
  redirect('/admin/login');
};

export const createCountry = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const parsed = countryInputSchema.parse({
      name: formData.get('name')
    });

    await db.insert(countries).values({
      name: parsed.name
    });
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const updateCountry = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const countryId = String(formData.get('countryId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(countryId)) {
      throw new Error('Invalid country id.');
    }

    const parsed = countryInputSchema.parse({
      name: formData.get('name')
    });

    const updated = await db
      .update(countries)
      .set({
        name: parsed.name
      })
      .where(eq(countries.id, countryId))
      .returning({ id: countries.id });

    if (updated.length === 0) {
      throw new Error('Country not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const deleteCountry = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const countryId = String(formData.get('countryId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(countryId)) {
      throw new Error('Invalid country id.');
    }

    const deleted = await db
      .delete(countries)
      .where(eq(countries.id, countryId))
      .returning({ id: countries.id });

    if (deleted.length === 0) {
      throw new Error('Country not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const createCity = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const setAsDefault = formData.get('isDefault') === 'on';
    const parsed = cityInputSchema.parse({
      name: formData.get('name'),
      countryId: formData.get('countryId')
    });

    const foundCountry = await db.query.countries.findFirst({
      where: eq(countries.id, parsed.countryId)
    });

    if (!foundCountry) {
      throw new Error('Country not found.');
    }

    await db.transaction(async (tx) => {
      if (setAsDefault) {
        await tx.update(cities).set({ isDefault: false });
      }

      await tx.insert(cities).values({
        name: parsed.name,
        countryId: parsed.countryId,
        isDefault: setAsDefault
      });
    });
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const updateCity = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const setAsDefault = formData.get('isDefault') === 'on';
    const cityId = String(formData.get('cityId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(cityId)) {
      throw new Error('Invalid city id.');
    }

    const parsed = cityInputSchema.parse({
      name: formData.get('name'),
      countryId: formData.get('countryId')
    });

    const foundCountry = await db.query.countries.findFirst({
      where: eq(countries.id, parsed.countryId)
    });
    if (!foundCountry) {
      throw new Error('Country not found.');
    }

    const updated = await db.transaction(async (tx) => {
      if (setAsDefault) {
        await tx.update(cities).set({ isDefault: false });
      }

      return tx
        .update(cities)
        .set({
          name: parsed.name,
          countryId: parsed.countryId,
          ...(setAsDefault ? { isDefault: true } : {})
        })
        .where(eq(cities.id, cityId))
        .returning({ id: cities.id });
    });

    if (updated.length === 0) {
      throw new Error('City not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const deleteCity = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const cityId = String(formData.get('cityId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(cityId)) {
      throw new Error('Invalid city id.');
    }

    const inUseByRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.cityId, cityId)
    });
    if (inUseByRestaurant) {
      throw new Error('Cannot delete this city because it has restaurants. Reassign or delete those restaurants first.');
    }

    const deleted = await db
      .delete(cities)
      .where(eq(cities.id, cityId))
      .returning({ id: cities.id });

    if (deleted.length === 0) {
      throw new Error('City not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const createRestaurantType = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const parsed = restaurantTypeInputSchema.parse({
      name: formData.get('name'),
      emoji: formData.get('emoji')
    });

    await db.insert(restaurantTypes).values({
      name: parsed.name,
      emoji: parsed.emoji
    });
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const updateRestaurantType = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const typeId = String(formData.get('typeId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(typeId)) {
      throw new Error('Invalid type id.');
    }

    const parsed = restaurantTypeInputSchema.parse({
      name: formData.get('name'),
      emoji: formData.get('emoji')
    });

    const updated = await db
      .update(restaurantTypes)
      .set({
        name: parsed.name,
        emoji: parsed.emoji
      })
      .where(eq(restaurantTypes.id, typeId))
      .returning({ id: restaurantTypes.id });

    if (updated.length === 0) {
      throw new Error('Restaurant type not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const deleteRestaurantType = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const typeId = String(formData.get('typeId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(typeId)) {
      throw new Error('Invalid type id.');
    }

    const inUseByRestaurant = await db.query.restaurantToTypes.findFirst({
      where: eq(restaurantToTypes.restaurantTypeId, typeId)
    });
    if (inUseByRestaurant) {
      throw new Error(
        'Cannot delete this restaurant type because it is used by restaurants. Remove it from those restaurants first.'
      );
    }

    const deleted = await db
      .delete(restaurantTypes)
      .where(eq(restaurantTypes.id, typeId))
      .returning({ id: restaurantTypes.id });

    if (deleted.length === 0) {
      throw new Error('Restaurant type not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const createRestaurant = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    await createRestaurantRecord(formData);

    cookies().set(ADMIN_SUCCESS_COOKIE, encodeURIComponent('Restaurant created.'), {
      httpOnly: false,
      maxAge: 60,
      path: '/admin',
      sameSite: 'lax'
    });
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

const createRestaurantRecord = async (formData: FormData): Promise<void> => {
  const db = getDb();
  const parsed = restaurantInputSchema.parse({
    cityId: formData.get('cityId'),
    areas: parseAreas(formData.get('areas')),
    mealTypes: formData.getAll('mealTypes'),
    name: formData.get('name'),
    notes: formData.get('notes'),
    referredBy: formData.get('referredBy') ?? undefined,
    typeIds: formData.getAll('typeIds'),
    url: formData.get('url'),
    status: formData.get('status'),
    dislikedReason: formData.get('dislikedReason') ?? undefined
  });

  const foundCity = await db.query.cities.findFirst({
    where: eq(cities.id, parsed.cityId)
  });

  if (!foundCity) {
    throw new Error('City not found.');
  }

  const existingTypes = await db
    .select({ id: restaurantTypes.id })
    .from(restaurantTypes)
    .where(inArray(restaurantTypes.id, parsed.typeIds));
  const foundTypeIds = new Set(existingTypes.map((entry) => entry.id));
  const invalidTypeIds = parsed.typeIds.filter((entry) => !foundTypeIds.has(entry));

  if (invalidTypeIds.length > 0) {
    throw new Error(`Invalid restaurant type ids: ${invalidTypeIds.join(', ')}.`);
  }

  await db.transaction(async (tx) => {
    const insertedRestaurants = await tx
      .insert(restaurants)
      .values({
        cityId: parsed.cityId,
        name: parsed.name,
        notes: parsed.notes,
        referredBy: parsed.referredBy ?? '',
        url: parsed.url,
        status: parsed.status,
        triedAt: parsed.status === 'untried' ? null : new Date(),
        dislikedReason: parsed.status === 'disliked' ? parsed.dislikedReason ?? null : null
      })
      .returning({ id: restaurants.id });
    const insertedRestaurant = insertedRestaurants[0];

    if (!insertedRestaurant) {
      throw new Error('Could not create restaurant.');
    }

    if (parsed.areas.length > 0) {
      await tx.insert(restaurantAreas).values(
        parsed.areas.map((area) => ({
          restaurantId: insertedRestaurant.id,
          area
        }))
      );
    }

    await tx.insert(restaurantMeals).values(
      parsed.mealTypes.map((mealType) => ({
        restaurantId: insertedRestaurant.id,
        mealType
      }))
    );

    await tx.insert(restaurantToTypes).values(
      parsed.typeIds.map((restaurantTypeId) => ({
        restaurantId: insertedRestaurant.id,
        restaurantTypeId
      }))
    );
  });
};

export const createRestaurantFromRoot = async (formData: FormData): Promise<void> => {
  const referer = headers().get('referer') ?? '/';
  const getRedirectTarget = (shouldOpenDialog: boolean): string => {
    try {
      const url = new URL(referer);
      if (shouldOpenDialog) {
        url.searchParams.set('openCreateDialog', '1');
      } else {
        url.searchParams.delete('openCreateDialog');
      }

      const query = url.searchParams.toString();
      return `${url.pathname}${query ? `?${query}` : ''}`;
    } catch {
      return shouldOpenDialog ? '/?openCreateDialog=1' : '/';
    }
  };

  try {
    await requireAdminSession();
    await createRestaurantRecord(formData);
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    cookies().set(ROOT_CREATE_ERROR_COOKIE, encodeURIComponent(getErrorText(error)), {
      httpOnly: false,
      maxAge: 60,
      path: '/',
      sameSite: 'lax'
    });
    redirect(getRedirectTarget(true));
  }

  cookies().set(ROOT_CREATE_ERROR_COOKIE, '', {
    httpOnly: false,
    maxAge: 0,
    path: '/',
    sameSite: 'lax'
  });
  cookies().set(ROOT_CREATE_SUCCESS_COOKIE, encodeURIComponent('Restaurant created successfully.'), {
    httpOnly: false,
    maxAge: 60,
    path: '/',
    sameSite: 'lax'
  });
  redirect(getRedirectTarget(false));
};

export const updateRestaurant = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    await updateRestaurantRecord(formData);
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

const updateRestaurantRecord = async (formData: FormData): Promise<string> => {
  const db = getDb();
  const restaurantId = String(formData.get('restaurantId') ?? '').trim();
  if (!ADMIN_ID_REGEX.test(restaurantId)) {
    throw new Error('Invalid restaurant id.');
  }

  const parsed = restaurantInputSchema.parse({
    cityId: formData.get('cityId'),
    areas: parseAreas(formData.get('areas')),
    mealTypes: formData.getAll('mealTypes'),
    name: formData.get('name'),
    notes: formData.get('notes'),
    referredBy: formData.get('referredBy') ?? undefined,
    typeIds: formData.getAll('typeIds'),
    url: formData.get('url'),
    status: formData.get('status'),
    dislikedReason: formData.get('dislikedReason') ?? undefined
  });

  const foundRestaurant = await db.query.restaurants.findFirst({
    where: eq(restaurants.id, restaurantId)
  });
  if (!foundRestaurant) {
    throw new Error('Restaurant not found.');
  }

  const foundCity = await db.query.cities.findFirst({
    where: eq(cities.id, parsed.cityId)
  });
  if (!foundCity) {
    throw new Error('City not found.');
  }

  const uniqueTypeIds = Array.from(new Set(parsed.typeIds));
  const existingTypes = await db
    .select({ id: restaurantTypes.id })
    .from(restaurantTypes)
    .where(inArray(restaurantTypes.id, uniqueTypeIds));
  const foundTypeIds = new Set(existingTypes.map((entry) => entry.id));
  const invalidTypeIds = uniqueTypeIds.filter((entry) => !foundTypeIds.has(entry));
  if (invalidTypeIds.length > 0) {
    throw new Error(`Invalid restaurant type ids: ${invalidTypeIds.join(', ')}.`);
  }

  await db.transaction(async (tx) => {
    const nextTriedAt =
      parsed.status === 'untried'
        ? null
        : foundRestaurant.status === 'untried'
          ? new Date()
          : foundRestaurant.triedAt ?? new Date();

    await tx
      .update(restaurants)
      .set({
        cityId: parsed.cityId,
        name: parsed.name,
        notes: parsed.notes,
        referredBy: parsed.referredBy ?? '',
        url: parsed.url,
        status: parsed.status,
        triedAt: nextTriedAt,
        dislikedReason: parsed.status === 'disliked' ? parsed.dislikedReason ?? null : null
      })
      .where(eq(restaurants.id, restaurantId));

    await tx.delete(restaurantAreas).where(eq(restaurantAreas.restaurantId, restaurantId));
    await tx.delete(restaurantMeals).where(eq(restaurantMeals.restaurantId, restaurantId));
    await tx.delete(restaurantToTypes).where(eq(restaurantToTypes.restaurantId, restaurantId));

    if (parsed.areas.length > 0) {
      await tx.insert(restaurantAreas).values(
        parsed.areas.map((area) => ({
          restaurantId,
          area
        }))
      );
    }

    await tx.insert(restaurantMeals).values(
      parsed.mealTypes.map((mealType) => ({
        restaurantId,
        mealType
      }))
    );

    await tx.insert(restaurantToTypes).values(
      uniqueTypeIds.map((restaurantTypeId) => ({
        restaurantId,
        restaurantTypeId
      }))
    );
  });

  return restaurantId;
};

export const updateRestaurantFromRoot = async (formData: FormData): Promise<void> => {
  const referer = headers().get('referer') ?? '/';
  const getRedirectTarget = (restaurantId: string | null): string => {
    try {
      const url = new URL(referer);
      if (restaurantId) {
        url.searchParams.set('openEditRestaurant', restaurantId);
      } else {
        url.searchParams.delete('openEditRestaurant');
      }

      const query = url.searchParams.toString();
      return `${url.pathname}${query ? `?${query}` : ''}`;
    } catch {
      return restaurantId ? `/?openEditRestaurant=${restaurantId}` : '/';
    }
  };

  try {
    await requireAdminSession();
    await updateRestaurantRecord(formData);
    cookies().set(ROOT_EDIT_ERROR_COOKIE, '', {
      httpOnly: false,
      maxAge: 0,
      path: '/',
      sameSite: 'lax'
    });
    cookies().set(ROOT_EDIT_SUCCESS_COOKIE, encodeURIComponent('Restaurant updated successfully.'), {
      httpOnly: false,
      maxAge: 60,
      path: '/',
      sameSite: 'lax'
    });
    redirect(getRedirectTarget(null));
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    const restaurantId = String(formData.get('restaurantId') ?? '').trim();
    const safeRestaurantId = ADMIN_ID_REGEX.test(restaurantId) ? restaurantId : null;
    cookies().set(ROOT_EDIT_ERROR_COOKIE, encodeURIComponent(getErrorText(error)), {
      httpOnly: false,
      maxAge: 60,
      path: '/',
      sameSite: 'lax'
    });
    redirect(getRedirectTarget(safeRestaurantId));
  }
};

export const deleteRestaurant = async (formData: FormData): Promise<void> => {
  const referer = headers().get('referer') ?? '/';
  const getRedirectTarget = (): string => {
    try {
      const url = new URL(referer);
      const query = url.searchParams.toString();
      return `${url.pathname}${query ? `?${query}` : ''}`;
    } catch {
      return '/';
    }
  };

  try {
    await requireAdminSession();
    const db = getDb();
    const restaurantId = String(formData.get('restaurantId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(restaurantId)) {
      throw new Error('Invalid restaurant id.');
    }

    const deleted = await db
      .update(restaurants)
      .set({ deletedAt: new Date() })
      .where(and(eq(restaurants.id, restaurantId), isNull(restaurants.deletedAt)))
      .returning({ id: restaurants.id });
    if (deleted.length === 0) {
      throw new Error('Restaurant not found.');
    }
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    cookies().set(ROOT_DELETE_ERROR_COOKIE, encodeURIComponent(getErrorText(error)), {
      httpOnly: false,
      maxAge: 60,
      path: '/',
      sameSite: 'lax'
    });
    redirect(getRedirectTarget());
  }

  cookies().set(ROOT_DELETE_ERROR_COOKIE, '', {
    httpOnly: false,
    maxAge: 0,
    path: '/',
    sameSite: 'lax'
  });
  redirect(getRedirectTarget());
};

export const restoreRestaurant = async (formData: FormData): Promise<void> => {
  try {
    await requireAdminSession();
    const db = getDb();
    const restaurantId = String(formData.get('restaurantId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(restaurantId)) {
      throw new Error('Invalid restaurant id.');
    }

    const restored = await db
      .update(restaurants)
      .set({ deletedAt: null })
      .where(and(eq(restaurants.id, restaurantId), isNotNull(restaurants.deletedAt)))
      .returning({ id: restaurants.id });

    if (restored.length === 0) {
      throw new Error('Deleted restaurant not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  cookies().set(ADMIN_SUCCESS_COOKIE, encodeURIComponent('Restaurant restored successfully.'), {
    httpOnly: false,
    maxAge: 60,
    path: '/admin',
    sameSite: 'lax'
  });
  redirect('/admin');
};

export const getCmsData = async (options?: { includeDeleted?: boolean }) => {
  const includeDeleted = options?.includeDeleted ?? false;
  const db = getDb();
  const [countryRows, cityRows, typeRows, restaurantRows, areaRows, mealRows, restaurantTypeRows] =
    await Promise.all([
      db.select().from(countries).orderBy(asc(countries.name)),
      db
        .select({
          id: cities.id,
          name: cities.name,
          isDefault: cities.isDefault,
          countryId: cities.countryId,
          countryName: countries.name
        })
        .from(cities)
        .innerJoin(countries, eq(cities.countryId, countries.id))
        .orderBy(asc(countries.name), asc(cities.name)),
      db.select().from(restaurantTypes).orderBy(asc(restaurantTypes.name)),
      db
        .select({
          id: restaurants.id,
          cityId: restaurants.cityId,
          name: restaurants.name,
          notes: restaurants.notes,
          referredBy: restaurants.referredBy,
          url: restaurants.url,
          status: restaurants.status,
          triedAt: restaurants.triedAt,
          deletedAt: restaurants.deletedAt,
          dislikedReason: restaurants.dislikedReason,
          cityName: cities.name,
          countryName: countries.name
        })
        .from(restaurants)
        .innerJoin(cities, eq(restaurants.cityId, cities.id))
        .innerJoin(countries, eq(cities.countryId, countries.id))
        .orderBy(asc(countries.name), asc(cities.name), asc(restaurants.name)),
      db.select().from(restaurantAreas),
      db.select().from(restaurantMeals),
      db
        .select({
          restaurantId: restaurantToTypes.restaurantId,
          typeId: restaurantTypes.id,
          typeName: restaurantTypes.name,
          typeEmoji: restaurantTypes.emoji
        })
        .from(restaurantToTypes)
        .innerJoin(restaurantTypes, eq(restaurantToTypes.restaurantTypeId, restaurantTypes.id))
    ]);

  const areasByRestaurant = new Map<string, string[]>();
  for (const area of areaRows) {
    const existing = areasByRestaurant.get(area.restaurantId) ?? [];
    existing.push(area.area);
    areasByRestaurant.set(area.restaurantId, existing);
  }

  const mealsByRestaurant = new Map<string, string[]>();
  for (const meal of mealRows) {
    const existing = mealsByRestaurant.get(meal.restaurantId) ?? [];
    existing.push(meal.mealType);
    mealsByRestaurant.set(meal.restaurantId, existing);
  }

  const typesByRestaurant = new Map<string, Array<{ id: string; name: string; emoji: string }>>();
  for (const row of restaurantTypeRows) {
    const existing = typesByRestaurant.get(row.restaurantId) ?? [];
    existing.push({ id: row.typeId, name: row.typeName, emoji: row.typeEmoji });
    typesByRestaurant.set(row.restaurantId, existing);
  }

  const fullRestaurants = restaurantRows.map((restaurant) => ({
    ...restaurant,
    areas: areasByRestaurant.get(restaurant.id) ?? [],
    mealTypes: mealsByRestaurant.get(restaurant.id) ?? [],
    types: typesByRestaurant.get(restaurant.id) ?? []
  }));
  const activeRestaurants = fullRestaurants.filter((restaurant) => restaurant.deletedAt === null);
  const deletedRestaurants = includeDeleted
    ? fullRestaurants.filter((restaurant) => restaurant.deletedAt !== null)
    : [];

  return {
    countries: countryRows,
    cities: cityRows,
    defaultCityName: cityRows.find((city) => city.isDefault)?.name ?? null,
    types: typeRows,
    restaurants: activeRestaurants,
    deletedRestaurants
  };
};
