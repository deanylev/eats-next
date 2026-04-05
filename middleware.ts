import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';
import { parseHostForTenant, resolveRequestHost } from '@/lib/tenant';

const redirectToPath = (request: NextRequest, path: string): NextResponse => {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = '';

  return NextResponse.redirect(url);
};

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? '';
  const session = token ? await verifyAdminJwt(token) : null;
  const host = resolveRequestHost(request.headers.get('host') || request.nextUrl.host, request.headers.get('x-forwarded-host'));
  const hostTenant = parseHostForTenant(host);
  const sessionMatchesHost = session
    ? hostTenant.isRootHost
      ? session.isRoot && session.tenantKey === 'root'
      : !session.isRoot && session.tenantKey === (hostTenant.subdomain ?? '')
    : false;

  if (pathname === '/admin/login/handoff') {
    return NextResponse.next();
  }

  if (pathname === '/admin/login') {
    if (session && sessionMatchesHost) {
      return redirectToPath(request, '/admin');
    }

    return NextResponse.next();
  }

  if (!session || !sessionMatchesHost) {
    return redirectToPath(request, '/admin/login');
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*']
};
