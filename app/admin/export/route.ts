import { NextResponse } from 'next/server';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { getDb } from '@/lib/db';
import { buildAllTenantsExport, buildSingleTenantExport } from '@/lib/data-transfer';
import { getCurrentAdminSession, resolveRequestTenant } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

const buildFileName = (scope: 'all' | 'single', tenantName: string, subdomain: string | null): string => {
  const slug = (subdomain ?? tenantName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tenant';

  return scope === 'all' ? 'eats-all-tenants-export.json' : `eats-${slug}-export.json`;
};

export async function GET(request: Request) {
  const tenant = await resolveRequestTenant();
  const session = await getCurrentAdminSession();

  if (!doesSessionMatchTenant(session, tenant)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedScope = new URL(request.url).searchParams.get('scope');
  if (requestedScope === 'all' && !tenant.isRoot) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const exportAllTenants = tenant.isRoot && requestedScope === 'all';
  const db = getDb();
  const payload = exportAllTenants
    ? await buildAllTenantsExport(db, tenant.id)
    : await buildSingleTenantExport(db, tenant.id);

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Disposition': `attachment; filename="${buildFileName(exportAllTenants ? 'all' : 'single', tenant.displayName, tenant.subdomain)}"`,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}
