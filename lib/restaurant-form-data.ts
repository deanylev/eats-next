import { parseAreas, restaurantInputSchema } from '@/lib/validators';

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
    status: formData.get('status'),
    dislikedReason: formData.get('dislikedReason') ?? undefined
  });
