import { normalizeHost, resolveRequestHost } from '@/lib/tenant';

type RequestOriginInput = {
  forwardedHost: string | null;
  host: string | null;
  origin: string | null;
  referer: string | null;
};

export const assertValidRequestOrigin = ({ forwardedHost, host, origin, referer }: RequestOriginInput): void => {
  const resolvedHost = resolveRequestHost(host, forwardedHost);

  if (!resolvedHost) {
    throw new Error('Invalid request origin.');
  }

  const source = origin || referer;
  if (!source) {
    throw new Error('Invalid request origin.');
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(source);
  } catch {
    throw new Error('Invalid request origin.');
  }

  const expectedHost = normalizeHost(resolvedHost);
  const actualHost = normalizeHost(parsedOrigin.host);
  if (actualHost !== expectedHost) {
    throw new Error('Invalid request origin.');
  }

  const isLocalHost = parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1';
  if (process.env.NODE_ENV === 'production' && !isLocalHost && parsedOrigin.protocol !== 'https:') {
    throw new Error('Invalid request origin.');
  }
};
