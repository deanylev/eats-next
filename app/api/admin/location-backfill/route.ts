import { NextResponse } from 'next/server';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { getDb } from '@/lib/db';
import { backfillRestaurantLocation } from '@/lib/restaurant-location-backfill';
import { getCurrentAdminSession, resolveRequestTenant } from '@/lib/request-context';
import { assertValidRequestOrigin } from '@/lib/request-origin';
import { cities, countries, restaurantLocations, restaurants } from '@/lib/schema';
import { isGoogleMapsUrl } from '@/lib/url';

const requestSchema = z.object({
  restaurantId: z.string().uuid('Invalid restaurant id.')
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

const getBackfillTargets = (tenantId: string) =>
  getDb()
    .select({
      id: restaurants.id,
      name: restaurants.name,
      url: restaurants.url,
      latitude: restaurants.latitude,
      longitude: restaurants.longitude,
      locationCount: sql<number>`(
        select count(*)::int from ${restaurantLocations}
        where ${restaurantLocations.restaurantId} = ${restaurants.id}
          and ${restaurantLocations.tenantId} = ${tenantId}
      )`,
      cityName: cities.name,
      countryName: countries.name
    })
    .from(restaurants)
    .innerJoin(cities, eq(restaurants.cityId, cities.id))
    .innerJoin(countries, eq(cities.countryId, countries.id))
    .where(and(eq(restaurants.tenantId, tenantId), isNull(restaurants.deletedAt)))
    .orderBy(asc(countries.name), asc(cities.name), asc(restaurants.name));

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth.error) {
    return auth.error;
  }

  if (!process.env.GOOGLE_MAPS_API_KEY?.trim()) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY is required to backfill location data.' }, { status: 503 });
  }

  const targets = (await getBackfillTargets(auth.tenantId)).filter(
    (restaurant) =>
      isGoogleMapsUrl(restaurant.url) &&
      restaurant.locationCount === 0
  );

  return NextResponse.json({
    restaurants: targets.map((restaurant) => ({
      id: restaurant.id,
      name: restaurant.name
    }))
  });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth.error) {
    return auth.error;
  }

  if (!process.env.GOOGLE_MAPS_API_KEY?.trim()) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY is required to backfill location data.' }, { status: 503 });
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

  const target = (await getBackfillTargets(auth.tenantId)).find((restaurant) => restaurant.id === parsed.data.restaurantId);
  if (!target) {
    return NextResponse.json({ error: 'Restaurant not found.' }, { status: 404 });
  }

  try {
    const result = await backfillRestaurantLocation(getDb(), target, auth.tenantId);
    return NextResponse.json({
      id: target.id,
      name: target.name,
      result
    });
  } catch (error) {
    console.error(`Failed to backfill restaurant location for ${target.id}`, error);
    return NextResponse.json({
      id: target.id,
      name: target.name,
      result: 'failed'
    });
  }
}
