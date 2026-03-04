import type { AdminJwtPayload } from '@/lib/auth';
import type { ResolvedTenant } from '@/lib/tenant';

type TenantIdentity = Pick<ResolvedTenant, 'id' | 'isRoot' | 'subdomain'>;

export const getTenantSessionKey = (tenant: Pick<TenantIdentity, 'isRoot' | 'subdomain'>): string =>
  tenant.isRoot ? 'root' : tenant.subdomain ?? '';

export const doesSessionMatchTenant = (
  session: AdminJwtPayload | null,
  tenant: TenantIdentity
): boolean => {
  if (!session) {
    return false;
  }

  return (
    session.tenantId === tenant.id &&
    session.isRoot === tenant.isRoot &&
    session.tenantKey === getTenantSessionKey(tenant)
  );
};
