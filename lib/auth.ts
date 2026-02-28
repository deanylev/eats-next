export const ADMIN_SESSION_COOKIE = 'admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type AdminJwtPayload = {
  sub: 'admin';
  username: string;
  iat: number;
  exp: number;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const fromBase64 = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const toBase64Url = (bytes: Uint8Array): string =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const fromBase64Url = (base64Url: string): Uint8Array => {
  const padded = `${base64Url}${'='.repeat((4 - (base64Url.length % 4)) % 4)}`;
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(base64);
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const getJwtSecret = (): string => {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error('Missing ADMIN_JWT_SECRET environment variable (minimum 16 chars).');
  }

  return secret;
};

const importHmacKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify'
  ]);

const signValue = async (value: string, secret: string): Promise<string> => {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
};

const verifyValue = async (value: string, signatureBase64Url: string, secret: string): Promise<boolean> => {
  const key = await importHmacKey(secret);
  const signatureBytes = fromBase64Url(signatureBase64Url);
  const signature = new Uint8Array(signatureBytes.byteLength);
  signature.set(signatureBytes);
  return crypto.subtle.verify('HMAC', key, signature, textEncoder.encode(value));
};

export const createAdminJwt = async (username: string): Promise<string> => {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminJwtPayload = {
    sub: 'admin',
    username,
    iat: now,
    exp: now + ADMIN_SESSION_TTL_SECONDS
  };

  const headerBase64Url = toBase64Url(
    textEncoder.encode(
      JSON.stringify({
        alg: 'HS256',
        typ: 'JWT'
      })
    )
  );
  const payloadBase64Url = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerBase64Url}.${payloadBase64Url}`;
  const signatureBase64Url = await signValue(signingInput, secret);

  return `${signingInput}.${signatureBase64Url}`;
};

export const verifyAdminJwt = async (token: string): Promise<AdminJwtPayload | null> => {
  try {
    const [headerBase64Url, payloadBase64Url, signatureBase64Url] = token.split('.');
    if (!headerBase64Url || !payloadBase64Url || !signatureBase64Url) {
      return null;
    }

    const header = JSON.parse(textDecoder.decode(fromBase64Url(headerBase64Url))) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }

    const payload = JSON.parse(textDecoder.decode(fromBase64Url(payloadBase64Url))) as Partial<AdminJwtPayload>;
    if (payload.sub !== 'admin' || typeof payload.username !== 'string') {
      return null;
    }

    if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now || payload.iat > now + 60) {
      return null;
    }

    const secret = getJwtSecret();
    const isValidSignature = await verifyValue(`${headerBase64Url}.${payloadBase64Url}`, signatureBase64Url, secret);
    if (!isValidSignature) {
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
