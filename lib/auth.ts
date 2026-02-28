import { SignJWT, jwtVerify } from 'jose';

export const ADMIN_SESSION_COOKIE = 'admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type AdminJwtPayload = {
  sub: 'admin';
  username: string;
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

export const createAdminJwt = async (username: string): Promise<string> =>
  new SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('admin')
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

    if (payload.sub !== 'admin' || typeof payload.username !== 'string') {
      return null;
    }

    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
      return null;
    }

    return {
      sub: 'admin',
      username: payload.username,
      iat: payload.iat,
      exp: payload.exp
    };
  } catch {
    return null;
  }
};
