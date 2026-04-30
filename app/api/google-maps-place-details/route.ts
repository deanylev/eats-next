import { NextResponse } from 'next/server';
import { z } from 'zod';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { getCurrentAdminSession, resolveRequestTenant } from '@/lib/request-context';
import { resolveGoogleMapsPlaceUrl } from '@/lib/google-maps';
import { assertValidRequestOrigin } from '@/lib/request-origin';

const requestSchema = z.object({
  placeId: z.string().trim().min(1, 'Place id is required.'),
  sessionToken: z.string().trim().min(1).optional()
});

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

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((issue) => issue.message).join(' ') || 'Invalid request.' },
      { status: 400 }
    );
  }

  try {
    const place = await resolveGoogleMapsPlaceUrl(parsed.data);
    return NextResponse.json(place);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
    const status = message.includes('GOOGLE_MAPS_API_KEY') ? 503 : 500;
    console.error('Failed to fetch Google Maps place details', error);
    return NextResponse.json({ error: message }, { status });
  }
}
