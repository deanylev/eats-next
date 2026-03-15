import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminJwt,
  verifyAdminHandoffToken
} from '@/lib/auth';
import { getTenantSessionKey } from '@/lib/admin-session';
import { getDb } from '@/lib/db';
import { tenants } from '@/lib/schema';
import { buildTenantHost, resolveRequestHostWithPort } from '@/lib/tenant';

const redirectToRelativePath = (path: string): NextResponse =>
  new NextResponse(null, {
    headers: {
      Location: path
    },
    status: 307
  });

const redirectToLogin = (error: string): NextResponse => redirectToRelativePath(`/admin/login?error=${error}`);

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const headerStore = headers();
  const token = requestUrl.searchParams.get('token') ?? '';
  const handoff = await verifyAdminHandoffToken(token);
  if (!handoff) {
    return redirectToLogin('invalid');
  }

  try {
    const tenantRecord = await getDb().query.tenants.findFirst({
      where: and(eq(tenants.id, handoff.targetTenantId), eq(tenants.isRoot, false))
    });
    if (
      !tenantRecord ||
      !tenantRecord.subdomain ||
      !tenantRecord.adminUsername ||
      getTenantSessionKey(tenantRecord) !== handoff.targetTenantKey
    ) {
      return redirectToLogin('misconfigured');
    }

    const currentHost = resolveRequestHostWithPort(headerStore.get('host'), headerStore.get('x-forwarded-host'));
    const expectedHost = buildTenantHost(currentHost || requestUrl.host, tenantRecord.subdomain);
    if (currentHost !== expectedHost) {
      requestUrl.host = expectedHost;
      return NextResponse.redirect(requestUrl);
    }

    const sessionToken = await createAdminJwt(tenantRecord.adminUsername, {
      tenantId: tenantRecord.id,
      tenantKey: getTenantSessionKey(tenantRecord),
      isRoot: false
    });
    const response = redirectToRelativePath('/admin');

    response.cookies.set(ADMIN_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      maxAge: ADMIN_SESSION_TTL_SECONDS,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    return response;
  } catch {
    return redirectToLogin('invalid');
  }
}
