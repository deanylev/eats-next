import { parseAreas, restaurantInputSchema } from '@/lib/validators';

const parseOptionalNumber = (value: FormDataEntryValue | null): number | null => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const parseRestaurantFormData = (formData: FormData) =>
  restaurantInputSchema.parse({
    cityId: formData.get('cityId'),
    areas: parseAreas(formData.get('areas')),
    mealTypes: formData.getAll('mealTypes'),
    name: formData.get('name'),
    notes: formData.get('notes'),
    referredBy: formData.get('referredBy') ?? undefined,
    typeIds: formData.getAll('typeIds'),
    url: formData.get('url'),
    googlePlaceId: formData.get('googlePlaceId') ?? undefined,
    address: formData.get('address') ?? undefined,
    latitude: parseOptionalNumber(formData.get('latitude')),
    longitude: parseOptionalNumber(formData.get('longitude')),
    status: formData.get('status'),
    dislikedReason: formData.get('dislikedReason') ?? undefined
  });
