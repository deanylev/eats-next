import { getDb } from '@/lib/db';
import { resolveGoogleMapsLocationFromUrl } from '@/lib/google-maps';
import { updateRestaurantLocationMetadataRecord } from '@/lib/cms-write';
import { isGoogleMapsUrl } from '@/lib/url';

type Db = ReturnType<typeof getDb>;

export type BackfillLocationResult = 'updated' | 'skipped' | 'failed';

export type RestaurantLocationBackfillTarget = {
  id: string;
  name: string;
  url: string;
  cityName: string;
  countryName: string;
  latitude: number | null;
  longitude: number | null;
};

export const backfillRestaurantLocation = async (
  db: Db,
  restaurant: RestaurantLocationBackfillTarget,
  tenantId: string,
  options?: { force?: boolean }
): Promise<BackfillLocationResult> => {
  if (!isGoogleMapsUrl(restaurant.url)) {
    return 'skipped';
  }

  if (!options?.force && restaurant.latitude !== null && restaurant.longitude !== null) {
    return 'skipped';
  }

  const location = await resolveGoogleMapsLocationFromUrl({
    cityName: restaurant.cityName,
    countryName: restaurant.countryName,
    name: restaurant.name,
    url: restaurant.url
  });

  if (!location || location.latitude === null || location.longitude === null) {
    return 'failed';
  }

  await updateRestaurantLocationMetadataRecord(db, tenantId, restaurant.id, {
    address: location.address,
    googlePlaceId: location.placeId,
    latitude: location.latitude,
    longitude: location.longitude
  });

  return 'updated';
};
