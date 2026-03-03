import { and, eq } from 'drizzle-orm';
import { tenants } from '@/lib/schema';

const defaultRootDisplayName = 'Dean';

export const getRootDomain = (): string => {
  const configured = process.env.ROOT_DOMAIN?.trim().toLowerCase() ?? '';
  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error('Missing ROOT_DOMAIN environment variable.');
  }

  return configured;
};

export const normalizeHost = (host: string): string => host.trim().toLowerCase().replace(/:\d+$/, '');

export const parseHostForTenant = (host: string): { isRootHost: boolean; subdomain: string | null } => {
  const normalizedHost = normalizeHost(host);
  if (normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') {
    return { isRootHost: true, subdomain: null };
  }

  if (normalizedHost.endsWith('.localhost')) {
    const localLabel = normalizedHost.slice(0, -'.localhost'.length);
    if (localLabel && !localLabel.includes('.') && localLabel.startsWith('eats-')) {
      return { isRootHost: false, subdomain: localLabel };
    }

    return { isRootHost: false, subdomain: null };
  }

  const rootDomain = getRootDomain();
  if (!rootDomain) {
    return { isRootHost: false, subdomain: null };
  }

  if (normalizedHost === rootDomain || normalizedHost === `www.${rootDomain}`) {
    return { isRootHost: true, subdomain: null };
  }

  const rootParts = rootDomain.split('.');
  if (rootParts.length < 2) {
    return { isRootHost: false, subdomain: null };
  }

  const rootLabel = rootParts[0];
  const baseDomain = rootParts.slice(1).join('.');
  const baseSuffix = `.${baseDomain}`;
  if (!normalizedHost.endsWith(baseSuffix)) {
    return { isRootHost: false, subdomain: null };
  }

  const candidateLabel = normalizedHost.slice(0, -baseSuffix.length);
  if (!candidateLabel || candidateLabel.includes('.')) {
    return { isRootHost: false, subdomain: null };
  }

  if (candidateLabel === rootLabel) {
    return { isRootHost: true, subdomain: null };
  }

  if (!candidateLabel.startsWith('eats-')) {
    return { isRootHost: false, subdomain: null };
  }

  return { isRootHost: false, subdomain: candidateLabel };
};

export const ensureRootTenant = async (db: any): Promise<{ id: string; displayName: string }> => {
  const existingRoot = await db.query.tenants.findFirst({
    where: eq(tenants.isRoot, true)
  });
  if (existingRoot) {
    return { id: existingRoot.id, displayName: existingRoot.displayName };
  }

  const inserted = await db
    .insert(tenants)
    .values({
      isRoot: true,
      displayName: defaultRootDisplayName,
      subdomain: null,
      adminUsername: null,
      adminPasswordHash: null
    })
    .returning({ id: tenants.id, displayName: tenants.displayName });

  const rootTenant = inserted[0];
  if (!rootTenant) {
    throw new Error('Could not initialize root tenant.');
  }

  return rootTenant;
};

export const resolveTenantFromHost = async (
  db: any,
  host: string
): Promise<{ id: string; displayName: string; subdomain: string | null; isRoot: boolean }> => {
  const parsed = parseHostForTenant(host);
  if (parsed.isRootHost) {
    const rootTenant = await ensureRootTenant(db);
    return {
      id: rootTenant.id,
      displayName: rootTenant.displayName,
      subdomain: null,
      isRoot: true
    };
  }

  if (!parsed.subdomain) {
    throw new Error('Invalid tenant subdomain.');
  }

  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.subdomain, parsed.subdomain), eq(tenants.isRoot, false))
  });

  if (!tenant) {
    throw new Error('Unknown tenant subdomain.');
  }

  return {
    id: tenant.id,
    displayName: tenant.displayName,
    subdomain: tenant.subdomain,
    isRoot: tenant.isRoot
  };
};
