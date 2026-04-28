import { NextResponse } from 'next/server';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { createOrGetCountryRecord } from '@/lib/cms-write';
import { getDb } from '@/lib/db';
import { getCurrentAdminSession, resolveRequestTenant } from '@/lib/request-context';
import { assertValidRequestOrigin } from '@/lib/request-origin';
import { countryInputSchema } from '@/lib/validators';

export async function POST(request: Request): Promise<Response> {
  try {
    assertValidRequestOrigin({
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer')
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const tenant = await resolveRequestTenant();
  const session = await getCurrentAdminSession();
  if (!doesSessionMatchTenant(session, tenant)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = countryInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((issue) => issue.message).join(' ') || 'Invalid country.' },
      { status: 400 }
    );
  }

  try {
    const country = await createOrGetCountryRecord(getDb(), tenant.id, parsed.data);
    return NextResponse.json({
      country: {
        id: country.id,
        name: country.name
      },
      duplicate: !country.created
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = String((error as { code?: string }).code ?? '');
      const constraint = String((error as { constraint?: string }).constraint ?? '');
      if (code === '23505' && constraint === 'countries_tenant_id_name_unique') {
        return NextResponse.json({ error: 'That country already exists.' }, { status: 409 });
      }
    }

    console.error('Failed to create inline country', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
