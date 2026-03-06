import { cookies, headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { decodeFlashMessage, type FlashCookieName } from '@/lib/flash-cookies';
import { ADMIN_SESSION_COOKIE, type AdminJwtPayload, verifyAdminJwt } from '@/lib/auth';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { resolveRequestHost, resolveTenantFromHost, type ResolvedTenant } from '@/lib/tenant';

export const resolveRequestTenant = async (): Promise<ResolvedTenant> => {
  const headerStore = headers();
  const host = resolveRequestHost(headerStore.get('host'), headerStore.get('x-forwarded-host'));
  return resolveTenantFromHost(getDb(), host);
};

export const getCurrentAdminSession = async (): Promise<AdminJwtPayload | null> => {
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? '';
  return token ? verifyAdminJwt(token) : null;
};

export const getAdminSessionForTenant = async (
  tenant: ResolvedTenant
): Promise<{ session: AdminJwtPayload | null; hasSession: boolean }> => {
  const session = await getCurrentAdminSession();
  return {
    session,
    hasSession: doesSessionMatchTenant(session, tenant)
  };
};

export const readFlashMessages = <TNames extends readonly FlashCookieName[]>(
  names: TNames
): Record<TNames[number], string | null> => {
  const cookieStore = cookies();

  return Object.fromEntries(
    names.map((name) => [name, decodeFlashMessage(cookieStore.get(name)?.value)])
  ) as Record<TNames[number], string | null>;
};
