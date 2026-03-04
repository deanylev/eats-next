'use server';

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
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
  restaurantTypes,
  tenants
} from '@/lib/schema';
import { normalizeHost, parseHostForTenant, resolveRequestHost, resolveTenantFromHost } from '@/lib/tenant';
import {
  cityInputSchema,
  countryInputSchema,
  parseAreas,
  restaurantInputSchema,
  restaurantTypeInputSchema
} from '@/lib/validators';

class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

const userFacingError = (message: string): UserFacingError => new UserFacingError(message);

const getUserErrorText = (error: unknown): string => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: string }).code ?? '');
    const constraint = String((error as { constraint?: string }).constraint ?? '');
    if (code === '23505' && constraint === 'tenants_subdomain_unique_idx') {
      return 'That subdomain already exists.';
    }
    if (code === '23505' && constraint === 'countries_tenant_id_name_unique') {
      return 'That country already exists for this tenant.';
    }
    if (code === '23505' && constraint === 'cities_tenant_id_country_id_name_unique') {
      return 'That city already exists in this country.';
    }
    if (
      code === '23505' &&
      (constraint === 'cities_single_default_idx' || constraint === 'cities_single_default_per_tenant_idx')
    ) {
      return 'Only one default city is allowed per tenant.';
    }
    if (code === '23505' && constraint === 'restaurant_types_tenant_id_name_unique') {
      return 'That restaurant type already exists.';
    }
    if (code === '23505' && constraint === 'restaurants_unique_active_city_name_idx') {
      return 'A restaurant with this name already exists in this city.';
    }
  }

  if (error && typeof error === 'object' && 'issues' in error) {
    const maybeIssues = (error as { issues?: Array<{ message?: string }> }).issues;
    if (maybeIssues && maybeIssues.length > 0) {
      return maybeIssues.map((issue) => issue.message ?? 'Validation error').join(' ');
    }
  }

  if (error instanceof Error) {
    if (error instanceof UserFacingError) {
      return error.message;
    }
  }

  console.error('Unhandled action error', error);
  return 'Something went wrong. Please try again.';
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

const assertSameOrigin = (): void => {
  const headerStore = headers();
  const origin = headerStore.get('origin');
  const referer = headerStore.get('referer');
  const host = resolveRequestHost(headerStore.get('host'), headerStore.get('x-forwarded-host'));

  if (!host) {
    throw userFacingError('Invalid request origin.');
  }

  const source = origin || referer;
  if (!source) {
    throw userFacingError('Invalid request origin.');
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(source);
  } catch {
    throw userFacingError('Invalid request origin.');
  }

  const expectedHost = normalizeHost(host);
  const actualHost = normalizeHost(parsedOrigin.host);
  if (actualHost !== expectedHost) {
    throw userFacingError('Invalid request origin.');
  }

  const isLocalHost = parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1';
  if (process.env.NODE_ENV === 'production' && !isLocalHost && parsedOrigin.protocol !== 'https:') {
    throw userFacingError('Invalid request origin.');
  }
};

const requireAdminSession = async (): Promise<AdminSessionContext> => {
  assertSameOrigin();
  const db = getDb();
  const host = getRequestHost();
  let tenant: Awaited<ReturnType<typeof resolveTenantFromHost>>;
  try {
    tenant = await resolveTenantFromHost(db, host);
  } catch {
    redirect('/admin/login');
  }
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? '';
  if (!token) {
    redirect('/admin/login');
  }

  const session = await verifyAdminJwt(token);
  const validForHost = Boolean(
    session &&
      session.tenantId === tenant.id &&
      session.tenantKey === (tenant.isRoot ? 'root' : tenant.subdomain ?? '') &&
      session.isRoot === tenant.isRoot
  );
  if (!validForHost || !session) {
    cookies().set(ADMIN_SESSION_COOKIE, '', {
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax'
    });
    redirect('/admin/login');
  }

  return { tenant, session };
};

const normalizedSha256 = (value: string): Buffer =>
  createHash('sha256').update(value.normalize('NFKC')).digest();

const safeCompare = (left: string, right: string): boolean => {
  const leftHash = normalizedSha256(left);
  const rightHash = normalizedSha256(right);
  return timingSafeEqual(leftHash, rightHash);
};

const hashTenantPassword = (password: string): string => {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize('NFKC'), salt, 64);
  return `${salt.toString('base64')}:${derived.toString('base64')}`;
};

const verifyTenantPassword = (password: string, storedHash: string): boolean => {
  const [saltBase64, hashBase64] = storedHash.split(':');
  if (!saltBase64 || !hashBase64) {
    return false;
  }

  try {
    const salt = Buffer.from(saltBase64, 'base64');
    const expected = Buffer.from(hashBase64, 'base64');
    const actual = scryptSync(password.normalize('NFKC'), salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

const getRequestHost = (): string => {
  const headerStore = headers();
  return resolveRequestHost(headerStore.get('host'), headerStore.get('x-forwarded-host'));
};

type AdminSessionContext = {
  tenant: { id: string; displayName: string; subdomain: string | null; isRoot: boolean };
  session: Awaited<ReturnType<typeof verifyAdminJwt>>;
};

const getClientIp = (): string => {
  const headerStore = headers();
  const cfConnectingIp = headerStore.get('cf-connecting-ip')?.trim() ?? '';
  if (cfConnectingIp && isIP(cfConnectingIp)) {
    return cfConnectingIp;
  }

  if (process.env.NODE_ENV === 'production') {
    return 'unknown';
  }

  const realIp = headerStore.get('x-real-ip')?.trim() ?? '';
  if (realIp && isIP(realIp)) {
    return realIp;
  }

  const forwardedCandidates = (headerStore.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const candidate of forwardedCandidates) {
    if (isIP(candidate)) {
      return candidate;
    }
  }

  return 'unknown';
};

const isValidTenantSubdomain = (value: string): boolean =>
  /^eats-[a-z0-9](?:[a-z0-9-]{1,55}[a-z0-9])?$/.test(value);

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
  assertSameOrigin();
  const db = getDb();
  const host = getRequestHost();
  const parsedHost = parseHostForTenant(host);
  let tenant: Awaited<ReturnType<typeof resolveTenantFromHost>>;
  try {
    tenant = await resolveTenantFromHost(db, host);
  } catch {
    redirect('/admin/login?error=invalid');
  }
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  const now = Date.now();
  const ip = getClientIp();
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (isIpBlocked(ip, now)) {
    redirect('/admin/login?error=rate');
  }

  if (parsedHost.isRootHost) {
    if (!expectedUsername || !expectedPassword) {
      redirect('/admin/login?error=misconfigured');
    }

    if (!safeCompare(username, expectedUsername) || !safeCompare(password, expectedPassword)) {
      markLoginFailure(ip, now);
      redirect('/admin/login?error=invalid');
    }
  } else {
    const tenantUser = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, tenant.id), eq(tenants.isRoot, false))
    });
    if (
      !tenantUser ||
      !tenantUser.adminUsername ||
      !tenantUser.adminPasswordHash ||
      !safeCompare(username, tenantUser.adminUsername) ||
      !verifyTenantPassword(password, tenantUser.adminPasswordHash)
    ) {
      markLoginFailure(ip, now);
      redirect('/admin/login?error=invalid');
    }
  }

  clearLoginFailures(ip);
  const token = await createAdminJwt(username, {
    tenantId: tenant.id,
    tenantKey: tenant.isRoot ? 'root' : tenant.subdomain ?? '',
    isRoot: tenant.isRoot
  });
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
  assertSameOrigin();
  cookies().set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });
  redirect('/admin/login');
};

export const createSubdomainTenant = async (formData: FormData): Promise<void> => {
  try {
    const { tenant, session } = await requireAdminSession();
    if (!tenant.isRoot || !session?.isRoot) {
      throw userFacingError('Only root admin can create subdomains.');
    }

    const db = getDb();
    const subdomain = String(formData.get('subdomain') ?? '').trim().toLowerCase();
    const adminUsername = String(formData.get('adminUsername') ?? '').trim();
    const adminPassword = String(formData.get('adminPassword') ?? '');
    const displayName = String(formData.get('displayName') ?? '').trim();

    if (!isValidTenantSubdomain(subdomain)) {
      throw userFacingError(
        'Subdomain must start with "eats-" and use lowercase letters, numbers, or hyphens (4-63 chars).'
      );
    }
    if (adminUsername.length < 3) {
      throw userFacingError('Username must be at least 3 characters.');
    }
    if (adminPassword.length < 8) {
      throw userFacingError('Password must be at least 8 characters.');
    }
    if (displayName.length < 1) {
      throw userFacingError('Display name is required.');
    }

    await db.insert(tenants).values({
      subdomain,
      displayName,
      adminUsername,
      adminPasswordHash: hashTenantPassword(adminPassword),
      isRoot: false
    });
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  cookies().set(ADMIN_SUCCESS_COOKIE, encodeURIComponent('Subdomain tenant created.'), {
    httpOnly: false,
    maxAge: 60,
    path: '/admin',
    sameSite: 'lax'
  });
  redirect('/admin');
};

export const updateSubdomainTenant = async (formData: FormData): Promise<void> => {
  try {
    const { tenant, session } = await requireAdminSession();
    if (!tenant.isRoot || !session?.isRoot) {
      throw userFacingError('Only root admin can update subdomains.');
    }

    const db = getDb();
    const tenantId = String(formData.get('tenantId') ?? '').trim();
    const subdomain = String(formData.get('subdomain') ?? '').trim().toLowerCase();
    const adminUsername = String(formData.get('adminUsername') ?? '').trim();
    const adminPassword = String(formData.get('adminPassword') ?? '');
    const displayName = String(formData.get('displayName') ?? '').trim();

    if (!ADMIN_ID_REGEX.test(tenantId)) {
      throw userFacingError('Invalid tenant id.');
    }
    if (!isValidTenantSubdomain(subdomain)) {
      throw userFacingError(
        'Subdomain must start with "eats-" and use lowercase letters, numbers, or hyphens (4-63 chars).'
      );
    }
    if (adminUsername.length < 3) {
      throw userFacingError('Username must be at least 3 characters.');
    }
    if (displayName.length < 1) {
      throw userFacingError('Display name is required.');
    }

    const found = await db.query.tenants.findFirst({
      where: and(eq(tenants.id, tenantId), eq(tenants.isRoot, false))
    });
    if (!found) {
      throw userFacingError('Subdomain tenant not found.');
    }

    await db
      .update(tenants)
      .set({
        subdomain,
        displayName,
        adminUsername,
        ...(adminPassword.trim().length > 0 ? { adminPasswordHash: hashTenantPassword(adminPassword) } : {})
      })
      .where(and(eq(tenants.id, tenantId), eq(tenants.isRoot, false)));
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  cookies().set(ADMIN_SUCCESS_COOKIE, encodeURIComponent('Subdomain tenant updated.'), {
    httpOnly: false,
    maxAge: 60,
    path: '/admin',
    sameSite: 'lax'
  });
  redirect('/admin');
};

export const updateCurrentTenantSettings = async (formData: FormData): Promise<void> => {
  try {
    const { tenant, session } = await requireAdminSession();
    if (tenant.isRoot) {
      throw userFacingError('Root tenant settings cannot be changed here.');
    }

    const db = getDb();
    const displayName = String(formData.get('displayName') ?? '').trim();
    if (displayName.length < 1) {
      throw userFacingError('Display name is required.');
    }

    const adminUsername = String(formData.get('adminUsername') ?? '').trim();
    const adminPassword = String(formData.get('adminPassword') ?? '');
    if (adminUsername.length < 3) {
      throw userFacingError('Username must be at least 3 characters.');
    }

    await db
      .update(tenants)
      .set({
        displayName,
        adminUsername,
        ...(adminPassword.trim().length > 0 ? { adminPasswordHash: hashTenantPassword(adminPassword) } : {})
      })
      .where(and(eq(tenants.id, tenant.id), eq(tenants.isRoot, false)));

    if (session && session.username !== adminUsername) {
      const nextToken = await createAdminJwt(adminUsername, {
        tenantId: tenant.id,
        tenantKey: tenant.subdomain ?? '',
        isRoot: false
      });
      cookies().set(ADMIN_SESSION_COOKIE, nextToken, {
        httpOnly: true,
        maxAge: ADMIN_SESSION_TTL_SECONDS,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });
    }
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  cookies().set(ADMIN_SUCCESS_COOKIE, encodeURIComponent('Tenant settings saved.'), {
    httpOnly: false,
    maxAge: 60,
    path: '/admin',
    sameSite: 'lax'
  });
  redirect('/admin');
};

export const createCountry = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const parsed = countryInputSchema.parse({
      name: formData.get('name')
    });

    await db.insert(countries).values({
      tenantId: tenant.id,
      name: parsed.name
    });
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

export const updateCountry = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const countryId = String(formData.get('countryId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(countryId)) {
      throw userFacingError('Invalid country id.');
    }

    const parsed = countryInputSchema.parse({
      name: formData.get('name')
    });

    const updated = await db
      .update(countries)
      .set({
        name: parsed.name
      })
      .where(and(eq(countries.id, countryId), eq(countries.tenantId, tenant.id)))
      .returning({ id: countries.id });

    if (updated.length === 0) {
      throw userFacingError('Country not found.');
    }
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

export const deleteCountry = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const countryId = String(formData.get('countryId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(countryId)) {
      throw userFacingError('Invalid country id.');
    }

    const deleted = await db
      .delete(countries)
      .where(and(eq(countries.id, countryId), eq(countries.tenantId, tenant.id)))
      .returning({ id: countries.id });

    if (deleted.length === 0) {
      throw userFacingError('Country not found.');
    }
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

export const createCity = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const setAsDefault = formData.get('isDefault') === 'on';
    const parsed = cityInputSchema.parse({
      name: formData.get('name'),
      countryId: formData.get('countryId')
    });

    const foundCountry = await db.query.countries.findFirst({
      where: and(eq(countries.id, parsed.countryId), eq(countries.tenantId, tenant.id))
    });

    if (!foundCountry) {
      throw userFacingError('Country not found.');
    }

    await db.transaction(async (tx) => {
      if (setAsDefault) {
        await tx.update(cities).set({ isDefault: false }).where(eq(cities.tenantId, tenant.id));
      }

      await tx.insert(cities).values({
        tenantId: tenant.id,
        name: parsed.name,
        countryId: parsed.countryId,
        isDefault: setAsDefault
      });
    });
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

export const updateCity = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const setAsDefault = formData.get('isDefault') === 'on';
    const cityId = String(formData.get('cityId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(cityId)) {
      throw userFacingError('Invalid city id.');
    }

    const parsed = cityInputSchema.parse({
      name: formData.get('name'),
      countryId: formData.get('countryId')
    });

    const foundCountry = await db.query.countries.findFirst({
      where: and(eq(countries.id, parsed.countryId), eq(countries.tenantId, tenant.id))
    });
    if (!foundCountry) {
      throw userFacingError('Country not found.');
    }

    const updated = await db.transaction(async (tx) => {
      if (setAsDefault) {
        await tx.update(cities).set({ isDefault: false }).where(eq(cities.tenantId, tenant.id));
      }

      return tx
        .update(cities)
        .set({
          name: parsed.name,
          tenantId: tenant.id,
          countryId: parsed.countryId,
          ...(setAsDefault ? { isDefault: true } : {})
        })
        .where(and(eq(cities.id, cityId), eq(cities.tenantId, tenant.id)))
        .returning({ id: cities.id });
    });

    if (updated.length === 0) {
      throw userFacingError('City not found.');
    }
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

export const deleteCity = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const cityId = String(formData.get('cityId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(cityId)) {
      throw userFacingError('Invalid city id.');
    }

    const inUseByRestaurant = await db.query.restaurants.findFirst({
      where: and(eq(restaurants.cityId, cityId), eq(restaurants.tenantId, tenant.id))
    });
    if (inUseByRestaurant) {
      throw userFacingError('Cannot delete this city because it has restaurants. Reassign or delete those restaurants first.');
    }

    const deleted = await db
      .delete(cities)
      .where(and(eq(cities.id, cityId), eq(cities.tenantId, tenant.id)))
      .returning({ id: cities.id });

    if (deleted.length === 0) {
      throw userFacingError('City not found.');
    }
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

export const createRestaurantType = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const parsed = restaurantTypeInputSchema.parse({
      name: formData.get('name'),
      emoji: formData.get('emoji')
    });

    await db.insert(restaurantTypes).values({
      tenantId: tenant.id,
      name: parsed.name,
      emoji: parsed.emoji
    });
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

export const updateRestaurantType = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const typeId = String(formData.get('typeId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(typeId)) {
      throw userFacingError('Invalid type id.');
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
      .where(and(eq(restaurantTypes.id, typeId), eq(restaurantTypes.tenantId, tenant.id)))
      .returning({ id: restaurantTypes.id });

    if (updated.length === 0) {
      throw userFacingError('Restaurant type not found.');
    }
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

export const deleteRestaurantType = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const typeId = String(formData.get('typeId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(typeId)) {
      throw userFacingError('Invalid type id.');
    }

    const inUseByRestaurant = await db.query.restaurantToTypes.findFirst({
      where: and(
        eq(restaurantToTypes.restaurantTypeId, typeId),
        sql`exists (
          select 1 from ${restaurants}
          where ${restaurants.id} = ${restaurantToTypes.restaurantId}
            and ${restaurants.tenantId} = ${tenant.id}
        )`
      )
    });
    if (inUseByRestaurant) {
      throw userFacingError(
        'Cannot delete this restaurant type because it is used by restaurants. Remove it from those restaurants first.'
      );
    }

    const deleted = await db
      .delete(restaurantTypes)
      .where(and(eq(restaurantTypes.id, typeId), eq(restaurantTypes.tenantId, tenant.id)))
      .returning({ id: restaurantTypes.id });

    if (deleted.length === 0) {
      throw userFacingError('Restaurant type not found.');
    }
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

export const createRestaurant = async (formData: FormData): Promise<void> => {
  try {
    const { tenant } = await requireAdminSession();
    await createRestaurantRecord(formData, tenant.id);

    cookies().set(ADMIN_SUCCESS_COOKIE, encodeURIComponent('Restaurant created.'), {
      httpOnly: false,
      maxAge: 60,
      path: '/admin',
      sameSite: 'lax'
    });
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

const createRestaurantRecord = async (formData: FormData, tenantId: string): Promise<void> => {
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
    where: and(eq(cities.id, parsed.cityId), eq(cities.tenantId, tenantId))
  });

  if (!foundCity) {
    throw userFacingError('City not found.');
  }

  const existingTypes = await db
    .select({ id: restaurantTypes.id })
    .from(restaurantTypes)
    .where(and(inArray(restaurantTypes.id, parsed.typeIds), eq(restaurantTypes.tenantId, tenantId)));
  const foundTypeIds = new Set(existingTypes.map((entry) => entry.id));
  const invalidTypeIds = parsed.typeIds.filter((entry) => !foundTypeIds.has(entry));

  if (invalidTypeIds.length > 0) {
    throw userFacingError('One or more restaurant types are invalid.');
  }

  const duplicateRestaurant = await db.query.restaurants.findFirst({
    where: and(
      eq(restaurants.cityId, parsed.cityId),
      eq(restaurants.tenantId, tenantId),
      isNull(restaurants.deletedAt),
      sql`lower(${restaurants.name}) = lower(${parsed.name})`
    )
  });
  if (duplicateRestaurant) {
    throw userFacingError('A restaurant with this name already exists in this city.');
  }

  await db.transaction(async (tx) => {
    const insertedRestaurants = await tx
      .insert(restaurants)
      .values({
        cityId: parsed.cityId,
        tenantId,
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
      throw userFacingError('Could not create restaurant.');
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
    const { tenant } = await requireAdminSession();
    await createRestaurantRecord(formData, tenant.id);
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    cookies().set(ROOT_CREATE_ERROR_COOKIE, encodeURIComponent(getUserErrorText(error)), {
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
    const { tenant } = await requireAdminSession();
    await updateRestaurantRecord(formData, tenant.id);
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  redirect('/admin');
};

const updateRestaurantRecord = async (formData: FormData, tenantId: string): Promise<string> => {
  const db = getDb();
  const restaurantId = String(formData.get('restaurantId') ?? '').trim();
  if (!ADMIN_ID_REGEX.test(restaurantId)) {
    throw userFacingError('Invalid restaurant id.');
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
    where: and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId))
  });
  if (!foundRestaurant) {
    throw userFacingError('Restaurant not found.');
  }

  const foundCity = await db.query.cities.findFirst({
    where: and(eq(cities.id, parsed.cityId), eq(cities.tenantId, tenantId))
  });
  if (!foundCity) {
    throw userFacingError('City not found.');
  }

  const uniqueTypeIds = Array.from(new Set(parsed.typeIds));
  const existingTypes = await db
    .select({ id: restaurantTypes.id })
    .from(restaurantTypes)
    .where(and(inArray(restaurantTypes.id, uniqueTypeIds), eq(restaurantTypes.tenantId, tenantId)));
  const foundTypeIds = new Set(existingTypes.map((entry) => entry.id));
  const invalidTypeIds = uniqueTypeIds.filter((entry) => !foundTypeIds.has(entry));
  if (invalidTypeIds.length > 0) {
    throw userFacingError('One or more restaurant types are invalid.');
  }

  const duplicateRestaurant = await db.query.restaurants.findFirst({
    where: and(
      ne(restaurants.id, restaurantId),
      eq(restaurants.cityId, parsed.cityId),
      eq(restaurants.tenantId, tenantId),
      isNull(restaurants.deletedAt),
      sql`lower(${restaurants.name}) = lower(${parsed.name})`
    )
  });
  if (duplicateRestaurant) {
    throw userFacingError('A restaurant with this name already exists in this city.');
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
        tenantId,
        name: parsed.name,
        notes: parsed.notes,
        referredBy: parsed.referredBy ?? '',
        url: parsed.url,
        status: parsed.status,
        triedAt: nextTriedAt,
        dislikedReason: parsed.status === 'disliked' ? parsed.dislikedReason ?? null : null
      })
      .where(and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId)));

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
    const { tenant } = await requireAdminSession();
    await updateRestaurantRecord(formData, tenant.id);
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
    cookies().set(ROOT_EDIT_ERROR_COOKIE, encodeURIComponent(getUserErrorText(error)), {
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
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const restaurantId = String(formData.get('restaurantId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(restaurantId)) {
      throw userFacingError('Invalid restaurant id.');
    }

    const deleted = await db
      .update(restaurants)
      .set({ deletedAt: new Date() })
      .where(and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenant.id), isNull(restaurants.deletedAt)))
      .returning({ id: restaurants.id });
    if (deleted.length === 0) {
      throw userFacingError('Restaurant not found.');
    }
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    cookies().set(ROOT_DELETE_ERROR_COOKIE, encodeURIComponent(getUserErrorText(error)), {
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
    const { tenant } = await requireAdminSession();
    const db = getDb();
    const restaurantId = String(formData.get('restaurantId') ?? '').trim();
    if (!ADMIN_ID_REGEX.test(restaurantId)) {
      throw userFacingError('Invalid restaurant id.');
    }

    const restored = await db
      .update(restaurants)
      .set({ deletedAt: null })
      .where(and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenant.id), isNotNull(restaurants.deletedAt)))
      .returning({ id: restaurants.id });

    if (restored.length === 0) {
      throw userFacingError('Deleted restaurant not found.');
    }
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  cookies().set(ADMIN_SUCCESS_COOKIE, encodeURIComponent('Restaurant restored successfully.'), {
    httpOnly: false,
    maxAge: 60,
    path: '/admin',
    sameSite: 'lax'
  });
  redirect('/admin');
};

export const getCmsData = async (tenantId: string, options?: { includeDeleted?: boolean }) => {
  const includeDeleted = options?.includeDeleted ?? false;
  const db = getDb();
  const [countryRows, cityRows, typeRows, restaurantRows, areaRows, mealRows, restaurantTypeRows] =
    await Promise.all([
      db
        .select()
        .from(countries)
        .where(eq(countries.tenantId, tenantId))
        .orderBy(asc(countries.name)),
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
        .where(eq(cities.tenantId, tenantId))
        .orderBy(asc(countries.name), asc(cities.name)),
      db
        .select()
        .from(restaurantTypes)
        .where(eq(restaurantTypes.tenantId, tenantId))
        .orderBy(asc(restaurantTypes.name)),
      db
        .select({
          id: restaurants.id,
          cityId: restaurants.cityId,
          name: restaurants.name,
          notes: restaurants.notes,
          referredBy: restaurants.referredBy,
          url: restaurants.url,
          createdAt: restaurants.createdAt,
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
        .where(eq(restaurants.tenantId, tenantId))
        .orderBy(asc(countries.name), asc(cities.name), asc(restaurants.name)),
      db
        .select()
        .from(restaurantAreas)
        .where(
          sql`exists (
            select 1 from ${restaurants}
            where ${restaurants.id} = ${restaurantAreas.restaurantId}
              and ${restaurants.tenantId} = ${tenantId}
          )`
        ),
      db
        .select()
        .from(restaurantMeals)
        .where(
          sql`exists (
            select 1 from ${restaurants}
            where ${restaurants.id} = ${restaurantMeals.restaurantId}
              and ${restaurants.tenantId} = ${tenantId}
          )`
        ),
      db
        .select({
          restaurantId: restaurantToTypes.restaurantId,
          typeId: restaurantTypes.id,
          typeName: restaurantTypes.name,
          typeEmoji: restaurantTypes.emoji
        })
        .from(restaurantToTypes)
        .innerJoin(restaurantTypes, eq(restaurantToTypes.restaurantTypeId, restaurantTypes.id))
        .where(eq(restaurantTypes.tenantId, tenantId))
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
