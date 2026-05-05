import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { getDb } from '@/lib/db';
import { getCurrentAdminSession, resolveRequestTenant } from '@/lib/request-context';
import { assertValidRequestOrigin } from '@/lib/request-origin';
import { restaurants } from '@/lib/schema';

const requestSchema = z.object({
  restaurantId: z.string().uuid('Invalid restaurant id.'),
  url: z
    .string()
    .trim()
    .url('Invalid URL.')
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'URL must start with http:// or https://.')
});

const authenticate = async (request: Request): Promise<
  | { error: Response; tenantId?: never }
  | { error?: never; tenantId: string }
> => {
  try {
    assertValidRequestOrigin({
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer')
    });
  } catch {
    return { error: NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 }) };
  }

  const tenant = await resolveRequestTenant();
  const session = await getCurrentAdminSession();
  if (!doesSessionMatchTenant(session, tenant)) {
    return { error: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }) };
  }

  return { tenantId: tenant.id };
};

export async function PATCH(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth.error) {
    return auth.error;
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

  const updatedRows = await getDb()
    .update(restaurants)
    .set({ url: parsed.data.url })
    .where(and(
      eq(restaurants.id, parsed.data.restaurantId),
      eq(restaurants.tenantId, auth.tenantId),
      isNull(restaurants.deletedAt)
    ))
    .returning({ id: restaurants.id, url: restaurants.url });

  if (!updatedRows[0]) {
    return NextResponse.json({ error: 'Restaurant not found.' }, { status: 404 });
  }

  return NextResponse.json({ restaurant: updatedRows[0] });
}
