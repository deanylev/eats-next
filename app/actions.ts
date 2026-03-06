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
  type AdminJwtPayload,
  createAdminJwt
} from '@/lib/auth';
import { getTenantSessionKey } from '@/lib/admin-session';
import {
  createCityRecord,
  createCountryRecord,
  createRestaurantRecord,
  createRestaurantTypeRecord,
  deleteCityRecord,
  deleteCountryRecord,
  deleteRestaurantTypeRecord,
  restoreRestaurantRecord,
  softDeleteRestaurantRecord,
  updateCityRecord,
  updateCountryRecord,
  updateRestaurantRecord,
  updateRestaurantTypeRecord
} from '@/lib/cms-write';
import { getDb } from '@/lib/db';
import { flashCookieNames, type FlashCookieName } from '@/lib/flash-cookies';
import { getCurrentAdminSession, resolveRequestTenant } from '@/lib/request-context';
import { clearFlashCookieServer, setFlashCookieServer } from '@/lib/server-flash-cookies';
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
import { normalizeHost, parseHostForTenant, resolveRequestHost, resolveTenantFromHost, type ResolvedTenant } from '@/lib/tenant';
import { DEFAULT_PRIMARY_COLOR } from '@/lib/theme';
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

const {
  adminError: ADMIN_ERROR_COOKIE,
  adminSuccess: ADMIN_SUCCESS_COOKIE,
  rootCreateError: ROOT_CREATE_ERROR_COOKIE,
  rootCreateSuccess: ROOT_CREATE_SUCCESS_COOKIE,
  rootEditError: ROOT_EDIT_ERROR_COOKIE,
  rootEditSuccess: ROOT_EDIT_SUCCESS_COOKIE,
  rootDeleteError: ROOT_DELETE_ERROR_COOKIE
} = flashCookieNames;
const ADMIN_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGIN_ATTEMPTS = 8;
const loginAttemptsByIp = new Map<string, { count: number; firstFailedAt: number; blockedUntil: number }>();
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const setAdminSuccess = (message: string): void => setFlashCookieServer(ADMIN_SUCCESS_COOKIE, message, '/admin');
const setRootSuccess = (name: FlashCookieName, message: string): void => setFlashCookieServer(name, message, '/');
const clearRootFlash = (name: FlashCookieName): void => clearFlashCookieServer(name, '/');
const setRootError = (name: FlashCookieName, message: string): void => setFlashCookieServer(name, message, '/');

const bounce = (errorMessage: string): never => {
  setFlashCookieServer(ADMIN_ERROR_COOKIE, errorMessage, '/admin');
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
  try {
    const tenant = await resolveRequestTenant();
    const session = await getCurrentAdminSession();
    if (!session) {
      redirect('/admin/login');
    }

    if (session.tenantId !== tenant.id || session.isRoot !== tenant.isRoot || session.tenantKey !== getTenantSessionKey(tenant)) {
      redirect('/admin/login');
    }

    return { tenant, session };
  } catch {
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
  tenant: ResolvedTenant;
  session: AdminJwtPayload;
};

const parseHexColor = (value: FormDataEntryValue | null, fieldName: string): string => {
  const color = String(value ?? '').trim();
  if (!HEX_COLOR_REGEX.test(color)) {
    throw userFacingError(`${fieldName} must be a valid hex color like ${DEFAULT_PRIMARY_COLOR}.`);
  }

  return color.toLowerCase();
};

const parseUuid = (value: FormDataEntryValue | null, message: string): string => {
  const parsed = String(value ?? '').trim();
  if (!ADMIN_ID_REGEX.test(parsed)) {
    throw userFacingError(message);
  }

  return parsed;
};

const parseCountryInput = (formData: FormData) =>
  countryInputSchema.parse({
    name: formData.get('name')
  });

const parseCityInput = (formData: FormData) => ({
  setAsDefault: formData.get('isDefault') === 'on',
  ...cityInputSchema.parse({
    name: formData.get('name'),
    countryId: formData.get('countryId')
  })
});

const parseRestaurantTypeInput = (formData: FormData) =>
  restaurantTypeInputSchema.parse({
    name: formData.get('name'),
    emoji: formData.get('emoji')
  });

const parseRestaurantInput = (formData: FormData) =>
  restaurantInputSchema.parse({
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

type ParsedTenantSettings = {
  displayName: string;
  adminUsername: string;
  adminPassword: string;
  primaryColor: string;
  secondaryColor: string;
};

const parseTenantSettings = (
  formData: FormData,
  options: { requirePassword: boolean }
): ParsedTenantSettings => {
  const displayName = String(formData.get('displayName') ?? '').trim();
  const adminUsername = String(formData.get('adminUsername') ?? '').trim();
  const adminPassword = String(formData.get('adminPassword') ?? '');
  const primaryColor = parseHexColor(formData.get('primaryColor'), 'Primary color');
  const secondaryColor = parseHexColor(formData.get('secondaryColor'), 'Secondary color');

  if (displayName.length < 1) {
    throw userFacingError('Display name is required.');
  }
  if (adminUsername.length < 3) {
    throw userFacingError('Username must be at least 3 characters.');
  }
  if (options.requirePassword && adminPassword.length < 8) {
    throw userFacingError('Password must be at least 8 characters.');
  }

  return {
    displayName,
    adminUsername,
    adminPassword,
    primaryColor,
    secondaryColor
  };
};

const setAdminSessionCookie = (token: string): void => {
  cookies().set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

const clearAdminSessionCookie = (): void => {
  cookies().set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });
};

const runAdminAction = async (
  action: () => Promise<void>,
  options?: { successMessage?: string }
): Promise<never> => {
  try {
    await action();
  } catch (error) {
    bounce(getUserErrorText(error));
  }

  if (options?.successMessage) {
    setAdminSuccess(options.successMessage);
  }
  redirect('/admin');
};

const getRefererRedirectTarget = (
  updates: Array<[key: string, value: string | null]>,
  fallbackPath: string
): string => {
  const referer = headers().get('referer') ?? fallbackPath;

  try {
    const url = new URL(referer);
    for (const [key, value] of updates) {
      if (value === null) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    }

    const query = url.searchParams.toString();
    return `${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    if (updates.length === 0) {
      return fallbackPath;
    }

    const params = new URLSearchParams();
    for (const [key, value] of updates) {
      if (value !== null) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return `${fallbackPath}${query ? `?${query}` : ''}`;
  }
};

const runRootAction = async (
  action: () => Promise<void>,
  options: {
    errorCookie: FlashCookieName;
    successCookie?: FlashCookieName;
    successMessage?: string;
    successRedirectTarget: string;
    errorRedirectTarget: string;
  }
): Promise<never> => {
  try {
    await action();
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    setRootError(options.errorCookie, getUserErrorText(error));
    redirect(options.errorRedirectTarget);
  }

  clearRootFlash(options.errorCookie);
  if (options.successCookie && options.successMessage) {
    setRootSuccess(options.successCookie, options.successMessage);
  }
  redirect(options.successRedirectTarget);
};

const requireRootAdminSession = async (): Promise<AdminSessionContext> => {
  const context = await requireAdminSession();
  if (!context.tenant.isRoot || !context.session.isRoot) {
    throw userFacingError('Only root admin can manage subdomains.');
  }

  return context;
};

const requireNonRootAdminSession = async (): Promise<AdminSessionContext> => {
  const context = await requireAdminSession();
  if (context.tenant.isRoot) {
    throw userFacingError('Root tenant settings cannot be changed here.');
  }

  return context;
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
  let tenant: ResolvedTenant;
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
    tenantKey: getTenantSessionKey(tenant),
    isRoot: tenant.isRoot
  });
  setAdminSessionCookie(token);

  redirect('/admin');
};

export const logoutAdmin = async (): Promise<void> => {
  assertSameOrigin();
  clearAdminSessionCookie();
  redirect('/admin/login');
};

export const createSubdomainTenant = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    await requireRootAdminSession();
    const db = getDb();
    const subdomain = String(formData.get('subdomain') ?? '').trim().toLowerCase();
    const { adminPassword, adminUsername, displayName, primaryColor, secondaryColor } = parseTenantSettings(formData, {
      requirePassword: true
    });

    if (!isValidTenantSubdomain(subdomain)) {
      throw userFacingError(
        'Subdomain must start with "eats-" and use lowercase letters, numbers, or hyphens (4-63 chars).'
      );
    }

    await db.insert(tenants).values({
      subdomain,
      displayName,
      primaryColor,
      secondaryColor,
      adminUsername,
      adminPasswordHash: hashTenantPassword(adminPassword),
      isRoot: false
    });
  }, { successMessage: 'Subdomain tenant created.' });
};

export const updateSubdomainTenant = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    await requireRootAdminSession();
    const db = getDb();
    const tenantId = parseUuid(formData.get('tenantId'), 'Invalid tenant id.');
    const subdomain = String(formData.get('subdomain') ?? '').trim().toLowerCase();
    const { adminPassword, adminUsername, displayName, primaryColor, secondaryColor } = parseTenantSettings(formData, {
      requirePassword: false
    });

    if (!isValidTenantSubdomain(subdomain)) {
      throw userFacingError(
        'Subdomain must start with "eats-" and use lowercase letters, numbers, or hyphens (4-63 chars).'
      );
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
        primaryColor,
        secondaryColor,
        adminUsername,
        ...(adminPassword.trim().length > 0 ? { adminPasswordHash: hashTenantPassword(adminPassword) } : {})
      })
      .where(and(eq(tenants.id, tenantId), eq(tenants.isRoot, false)));
  }, { successMessage: 'Subdomain tenant updated.' });
};

export const updateCurrentTenantSettings = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant, session } = await requireNonRootAdminSession();
    const db = getDb();
    const { adminPassword, adminUsername, displayName, primaryColor, secondaryColor } = parseTenantSettings(formData, {
      requirePassword: false
    });

    await db
      .update(tenants)
      .set({
        displayName,
        primaryColor,
        secondaryColor,
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
      setAdminSessionCookie(nextToken);
    }
  }, { successMessage: 'Tenant settings saved.' });
};

export const createCountry = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const parsed = parseCountryInput(formData);
    await createCountryRecord(getDb(), tenant.id, parsed);
  }, { successMessage: 'Country created.' });
};

export const updateCountry = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const countryId = parseUuid(formData.get('countryId'), 'Invalid country id.');
    const parsed = parseCountryInput(formData);
    await updateCountryRecord(getDb(), tenant.id, countryId, parsed);
  });
};

export const deleteCountry = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const countryId = parseUuid(formData.get('countryId'), 'Invalid country id.');
    await deleteCountryRecord(getDb(), tenant.id, countryId);
  });
};

export const createCity = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const parsed = parseCityInput(formData);
    await createCityRecord(getDb(), tenant.id, parsed);
  }, { successMessage: 'City created.' });
};

export const updateCity = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const cityId = parseUuid(formData.get('cityId'), 'Invalid city id.');
    const parsed = parseCityInput(formData);
    await updateCityRecord(getDb(), tenant.id, cityId, parsed);
  });
};

export const deleteCity = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const cityId = parseUuid(formData.get('cityId'), 'Invalid city id.');
    await deleteCityRecord(getDb(), tenant.id, cityId);
  });
};

export const createRestaurantType = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const parsed = parseRestaurantTypeInput(formData);
    await createRestaurantTypeRecord(getDb(), tenant.id, parsed);
  }, { successMessage: 'Restaurant type created.' });
};

export const updateRestaurantType = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const typeId = parseUuid(formData.get('typeId'), 'Invalid type id.');
    const parsed = parseRestaurantTypeInput(formData);
    await updateRestaurantTypeRecord(getDb(), tenant.id, typeId, parsed);
  });
};

export const deleteRestaurantType = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const typeId = parseUuid(formData.get('typeId'), 'Invalid type id.');
    await deleteRestaurantTypeRecord(getDb(), tenant.id, typeId);
  });
};

export const createRestaurant = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    await createRestaurantRecord(getDb(), tenant.id, parseRestaurantInput(formData));
  }, { successMessage: 'Restaurant created.' });
};

export const createRestaurantFromRoot = async (formData: FormData): Promise<void> => {
  return runRootAction(
    async () => {
      const { tenant } = await requireAdminSession();
      await createRestaurantRecord(getDb(), tenant.id, parseRestaurantInput(formData));
    },
    {
      errorCookie: ROOT_CREATE_ERROR_COOKIE,
      successCookie: ROOT_CREATE_SUCCESS_COOKIE,
      successMessage: 'Restaurant created successfully.',
      successRedirectTarget: getRefererRedirectTarget([['openCreateDialog', null]], '/'),
      errorRedirectTarget: getRefererRedirectTarget([['openCreateDialog', '1']], '/')
    }
  );
};

export const updateRestaurant = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const restaurantId = parseUuid(formData.get('restaurantId'), 'Invalid restaurant id.');
    await updateRestaurantRecord(getDb(), tenant.id, restaurantId, parseRestaurantInput(formData));
  });
};

export const updateRestaurantFromRoot = async (formData: FormData): Promise<void> => {
  const rawRestaurantId = String(formData.get('restaurantId') ?? '').trim();
  const safeRestaurantId = ADMIN_ID_REGEX.test(rawRestaurantId) ? rawRestaurantId : null;

  return runRootAction(
    async () => {
      const { tenant } = await requireAdminSession();
      const restaurantId = parseUuid(formData.get('restaurantId'), 'Invalid restaurant id.');
      await updateRestaurantRecord(getDb(), tenant.id, restaurantId, parseRestaurantInput(formData));
    },
    {
      errorCookie: ROOT_EDIT_ERROR_COOKIE,
      successCookie: ROOT_EDIT_SUCCESS_COOKIE,
      successMessage: 'Restaurant updated successfully.',
      successRedirectTarget: getRefererRedirectTarget([['openEditRestaurant', null]], '/'),
      errorRedirectTarget: getRefererRedirectTarget([['openEditRestaurant', safeRestaurantId]], '/')
    }
  );
};

export const deleteRestaurant = async (formData: FormData): Promise<void> => {
  return runRootAction(
    async () => {
      const { tenant } = await requireAdminSession();
      const restaurantId = parseUuid(formData.get('restaurantId'), 'Invalid restaurant id.');
      await softDeleteRestaurantRecord(getDb(), tenant.id, restaurantId);
    },
    {
      errorCookie: ROOT_DELETE_ERROR_COOKIE,
      successRedirectTarget: getRefererRedirectTarget([], '/'),
      errorRedirectTarget: getRefererRedirectTarget([], '/')
    }
  );
};

export const restoreRestaurant = async (formData: FormData): Promise<void> => {
  return runAdminAction(async () => {
    const { tenant } = await requireAdminSession();
    const restaurantId = parseUuid(formData.get('restaurantId'), 'Invalid restaurant id.');
    await restoreRestaurantRecord(getDb(), tenant.id, restaurantId);
  }, { successMessage: 'Restaurant restored successfully.' });
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
