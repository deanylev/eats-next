import { and, eq } from 'drizzle-orm';
import type { getDb } from '@/lib/db';
import { tenants } from '@/lib/schema';
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@/lib/theme';

const defaultRootDisplayName = 'Dean';
type TenantDb = ReturnType<typeof getDb>;
type RootTenant = { id: string; displayName: string; primaryColor: string; secondaryColor: string };

export type ResolvedTenant = {
  id: string;
  displayName: string;
  subdomain: string | null;
  isRoot: boolean;
  primaryColor: string;
  secondaryColor: string;
};

export const getRootDomain = (): string => {
  const configured = normalizeHost(process.env.ROOT_DOMAIN ?? '');
  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error('Missing ROOT_DOMAIN environment variable.');
  }

  return configured;
};

export const normalizeHost = (host: string): string => host.trim().toLowerCase().replace(/:\d+$/, '');

const getHostPort = (host: string): string => {
  const trimmed = host.trim();
  const match = trimmed.match(/:(\d+)$/);
  return match ? `:${match[1]}` : '';
};

const getFirstForwardedHost = (forwardedHost: string | null): string => {
  if (!forwardedHost) {
    return '';
  }

  return forwardedHost
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0) ?? '';
};

const getHostFromUrlLikeHeader = (value: string | null): string => {
  if (!value) {
    return '';
  }

  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
};

const isPrivateIpv4Host = (host: string): boolean => {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }

  const [a, b] = parts.map((part) => Number(part));
  if (a === 10 || a === 127) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  return false;
};

const isInternalProxyHost = (host: string): boolean => {
  if (!host) {
    return false;
  }

  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
    return true;
  }

  if (isPrivateIpv4Host(host)) {
    return true;
  }

  return !host.includes('.');
};

export const resolveRequestHost = (hostHeader: string | null, forwardedHostHeader: string | null): string => {
  const normalizedHost = normalizeHost(hostHeader ?? '');
  const normalizedForwardedHost = normalizeHost(getFirstForwardedHost(forwardedHostHeader));

  if (isInternalProxyHost(normalizedHost) && normalizedForwardedHost) {
    return normalizedForwardedHost;
  }

  return normalizedHost || normalizedForwardedHost;
};

export const resolveRequestHostWithPort = (hostHeader: string | null, forwardedHostHeader: string | null): string => {
  const rawHost = (hostHeader ?? '').trim().toLowerCase();
  const rawForwardedHost = getFirstForwardedHost(forwardedHostHeader).toLowerCase();

  if (isInternalProxyHost(normalizeHost(rawHost)) && rawForwardedHost) {
    return rawForwardedHost;
  }

  return rawHost || rawForwardedHost;
};

export const resolvePublicRequestHostWithPort = (
  hostHeader: string | null,
  forwardedHostHeader: string | null,
  originHeader: string | null,
  refererHeader: string | null
): string => {
  const originHost = getHostFromUrlLikeHeader(originHeader);
  if (originHost) {
    return originHost;
  }

  const refererHost = getHostFromUrlLikeHeader(refererHeader);
  if (refererHost) {
    return refererHost;
  }

  const rawForwardedHost = getFirstForwardedHost(forwardedHostHeader).toLowerCase();
  if (rawForwardedHost) {
    return rawForwardedHost;
  }

  return (hostHeader ?? '').trim().toLowerCase();
};

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

export const buildTenantHost = (requestHost: string, subdomain: string | null): string => {
  const normalizedHost = normalizeHost(requestHost);
  const port = getHostPort(requestHost);

  if (
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost.endsWith('.localhost')
  ) {
    return subdomain ? `${subdomain}.localhost${port}` : `localhost${port}`;
  }

  const rootDomain = getRootDomain();
  if (!rootDomain) {
    throw new Error('Missing ROOT_DOMAIN environment variable.');
  }

  if (!subdomain) {
    return rootDomain;
  }

  const rootParts = rootDomain.split('.');
  if (rootParts.length < 2) {
    throw new Error('Invalid ROOT_DOMAIN environment variable.');
  }

  return `${subdomain}.${rootParts.slice(1).join('.')}`;
};

export const ensureRootTenant = async (db: TenantDb): Promise<RootTenant> => {
  const existingRoot = await db.query.tenants.findFirst({
    where: eq(tenants.isRoot, true)
  });
  if (existingRoot) {
    return {
      id: existingRoot.id,
      displayName: existingRoot.displayName,
      primaryColor: existingRoot.primaryColor,
      secondaryColor: existingRoot.secondaryColor
    };
  }

  const inserted = await db
    .insert(tenants)
    .values({
      isRoot: true,
      displayName: defaultRootDisplayName,
      primaryColor: DEFAULT_PRIMARY_COLOR,
      secondaryColor: DEFAULT_SECONDARY_COLOR,
      subdomain: null,
      adminUsername: null,
      adminPasswordHash: null
    })
    .returning({
      id: tenants.id,
      displayName: tenants.displayName,
      primaryColor: tenants.primaryColor,
      secondaryColor: tenants.secondaryColor
    });

  const rootTenant = inserted[0];
  if (!rootTenant) {
    throw new Error('Could not initialize root tenant.');
  }

  return rootTenant;
};

export const resolveTenantFromHost = async (db: TenantDb, host: string): Promise<ResolvedTenant> => {
  const parsed = parseHostForTenant(host);
  if (parsed.isRootHost) {
    const rootTenant = await ensureRootTenant(db);
    return {
      id: rootTenant.id,
      displayName: rootTenant.displayName,
      subdomain: null,
      isRoot: true,
      primaryColor: rootTenant.primaryColor,
      secondaryColor: rootTenant.secondaryColor
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
    isRoot: tenant.isRoot,
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor
  };
};
