import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { getDb } from '@/lib/db';
import { getCurrentAdminSession, resolveRequestTenant } from '@/lib/request-context';
import { assertValidRequestOrigin } from '@/lib/request-origin';
import { restaurantLocations, restaurants } from '@/lib/schema';

const requestSchema = z.object({
  restaurantId: z.string().uuid('Invalid restaurant id.'),
  label: z.string().trim().optional(),
  address: z.string().trim().optional(),
  googlePlaceId: z.string().trim().optional(),
  googleMapsUrl: z.string().trim().url('Invalid Google Maps URL.'),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180)
});

const isDuplicateRestaurantLocationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  const code = String((error as { code?: string }).code ?? '');
  const constraint = String((error as { constraint?: string }).constraint ?? '');
  return code === '23505' && constraint.includes('restaurant_locations_tenant_id_restaurant_id_google_place_id');
};

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

export async function POST(request: Request): Promise<Response> {
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

  const restaurant = await getDb().query.restaurants.findFirst({
    where: and(
      eq(restaurants.id, parsed.data.restaurantId),
      eq(restaurants.tenantId, auth.tenantId),
      isNull(restaurants.deletedAt)
    )
  });
  if (!restaurant) {
    return NextResponse.json({ error: 'Restaurant not found.' }, { status: 404 });
  }

  let insertedRows: Array<{
    id: string;
    label: string | null;
    address: string | null;
    googlePlaceId: string | null;
    googleMapsUrl: string | null;
    latitude: number;
    longitude: number;
  }>;
  try {
    insertedRows = await getDb()
      .insert(restaurantLocations)
      .values({
        id: randomUUID(),
        tenantId: auth.tenantId,
        restaurantId: parsed.data.restaurantId,
        label: parsed.data.label || null,
        address: parsed.data.address || null,
        googlePlaceId: parsed.data.googlePlaceId || null,
        googleMapsUrl: parsed.data.googleMapsUrl,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude
      })
      .returning({
        id: restaurantLocations.id,
        label: restaurantLocations.label,
        address: restaurantLocations.address,
        googlePlaceId: restaurantLocations.googlePlaceId,
        googleMapsUrl: restaurantLocations.googleMapsUrl,
        latitude: restaurantLocations.latitude,
        longitude: restaurantLocations.longitude
      });
  } catch (error) {
    if (isDuplicateRestaurantLocationError(error)) {
      return NextResponse.json({ error: 'That map location is already saved for this restaurant.' }, { status: 409 });
    }

    console.error('Failed to create restaurant location', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ location: insertedRows[0] });
}
