import { SignJWT, jwtVerify } from 'jose';

export const ADMIN_SESSION_COOKIE = 'admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const ADMIN_HANDOFF_TTL_SECONDS = 60;

export type AdminJwtPayload = {
  sub: 'admin_root' | 'admin_tenant';
  username: string;
  tenantId: string;
  tenantKey: string;
  isRoot: boolean;
  iat: number;
  exp: number;
};

export type AdminHandoffPayload = {
  sub: 'admin_handoff';
  sourceUsername: string;
  sourceTenantId: string;
  sourceTenantKey: string;
  sourceIsRoot: true;
  targetTenantId: string;
  targetTenantKey: string;
  iat: number;
  exp: number;
};

const getJwtSecret = (): string => {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error('Missing ADMIN_JWT_SECRET environment variable (minimum 32 chars).');
  }

  return secret;
};

const getSigningKey = (): Uint8Array => new TextEncoder().encode(getJwtSecret());

export const createAdminJwt = async (
  username: string,
  options: { tenantId: string; tenantKey: string; isRoot: boolean }
): Promise<string> =>
  new SignJWT({
    username,
    tenantId: options.tenantId,
    tenantKey: options.tenantKey,
    isRoot: options.isRoot
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(options.isRoot ? 'admin_root' : 'admin_tenant')
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(getSigningKey());

export const verifyAdminJwt = async (token: string): Promise<AdminJwtPayload | null> => {
  try {
    if (token.length > 4096) {
      return null;
    }

    const { payload, protectedHeader } = await jwtVerify(token, getSigningKey(), {
      algorithms: ['HS256']
    });

    if (protectedHeader.typ !== 'JWT') {
      return null;
    }

    if ((payload.sub !== 'admin_root' && payload.sub !== 'admin_tenant') || typeof payload.username !== 'string') {
      return null;
    }

    if (typeof payload.tenantId !== 'string' || typeof payload.tenantKey !== 'string') {
      return null;
    }

    if (typeof payload.isRoot !== 'boolean') {
      return null;
    }

    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
      return null;
    }

    return {
      sub: payload.sub,
      username: payload.username,
      tenantId: payload.tenantId,
      tenantKey: payload.tenantKey,
      isRoot: payload.isRoot,
      iat: payload.iat,
      exp: payload.exp
    };
  } catch {
    return null;
  }
};

export const createAdminHandoffToken = async (options: {
  sourceUsername: string;
  sourceTenantId: string;
  sourceTenantKey: string;
  targetTenantId: string;
  targetTenantKey: string;
}): Promise<string> =>
  new SignJWT({
    sourceUsername: options.sourceUsername,
    sourceTenantId: options.sourceTenantId,
    sourceTenantKey: options.sourceTenantKey,
    sourceIsRoot: true,
    targetTenantId: options.targetTenantId,
    targetTenantKey: options.targetTenantKey
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('admin_handoff')
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_HANDOFF_TTL_SECONDS}s`)
    .sign(getSigningKey());

export const verifyAdminHandoffToken = async (token: string): Promise<AdminHandoffPayload | null> => {
  try {
    if (token.length > 4096) {
      return null;
    }

    const { payload, protectedHeader } = await jwtVerify(token, getSigningKey(), {
      algorithms: ['HS256']
    });

    if (protectedHeader.typ !== 'JWT') {
      return null;
    }

    if (payload.sub !== 'admin_handoff') {
      return null;
    }

    if (
      typeof payload.sourceUsername !== 'string' ||
      typeof payload.sourceTenantId !== 'string' ||
      typeof payload.sourceTenantKey !== 'string' ||
      payload.sourceIsRoot !== true ||
      typeof payload.targetTenantId !== 'string' ||
      typeof payload.targetTenantKey !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }

    return {
      sub: 'admin_handoff',
      sourceUsername: payload.sourceUsername,
      sourceTenantId: payload.sourceTenantId,
      sourceTenantKey: payload.sourceTenantKey,
      sourceIsRoot: true,
      targetTenantId: payload.targetTenantId,
      targetTenantKey: payload.targetTenantKey,
      iat: payload.iat,
      exp: payload.exp
    };
  } catch {
    return null;
  }
};
