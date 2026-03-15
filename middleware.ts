import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';
import { parseHostForTenant, resolveRequestHost } from '@/lib/tenant';

const redirectToRelativePath = (path: string): NextResponse =>
  new NextResponse(null, {
    headers: {
      Location: path
    },
    status: 307
  });

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
      return redirectToRelativePath('/admin');
    }

    return NextResponse.next();
  }

  if (!session || !sessionMatchesHost) {
    return redirectToRelativePath('/admin/login');
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*']
};
