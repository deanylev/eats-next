import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const unauthorizedResponse = () =>
  new NextResponse('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Admin", charset="UTF-8"'
    }
  });

const parseBasicAuth = (headerValue: string): { username: string; password: string } | null => {
  const [scheme, encoded] = headerValue.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    return null;
  }

  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
};

export function middleware(request: NextRequest) {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return new NextResponse(
      'Missing ADMIN_USERNAME or ADMIN_PASSWORD environment variables.',
      { status: 500 }
    );
  }

  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return unauthorizedResponse();
  }

  const credentials = parseBasicAuth(authorization);
  if (!credentials) {
    return unauthorizedResponse();
  }

  if (credentials.username !== expectedUsername || credentials.password !== expectedPassword) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*']
};

