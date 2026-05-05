import { z } from 'zod';
import { mealTypeEnum, restaurantStatusEnum } from '@/lib/schema';

const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL must start with http:// or https://.');
const emojiRegex = /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u;
const optionalCoordinateSchema = z
  .number()
  .finite()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const restaurantLocationInputSchema = z.object({
  id: z.string().uuid('Invalid location id.').optional(),
  label: z.string().trim().optional(),
  address: z.string().trim().optional(),
  googlePlaceId: z.string().trim().optional(),
  googleMapsUrl: z.string().trim().optional().default('').refine((value) => value.length === 0 || httpUrlSchema.safeParse(value).success, {
    message: 'Location Google Maps URL must start with http:// or https://.'
  }),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180)
});

export const countryInputSchema = z.object({
  name: z.string().trim().min(1, 'Country name is required.')
});

export const cityInputSchema = z.object({
  name: z.string().trim().min(1, 'City name is required.'),
  countryId: z.string().uuid('Invalid country id.')
});

export const restaurantTypeInputSchema = z.object({
  name: z.string().trim().min(1, 'Type name is required.'),
  emoji: z
    .string()
    .trim()
    .min(1, 'Emoji is required.')
    .refine((value) => emojiRegex.test(value), 'Type emoji must contain an emoji character.')
});

const referredByInputSchema = z
  .string()
  .trim()
  .optional()
  .superRefine((value, ctx) => {
    if (!value || value.length === 0) {
      return;
    }

    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Referred by URL must start with http:// or https://.'
        });
      }
      return;
    } catch {
      if (value.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Referred by text is too short.'
        });
      }
    }
  });

export const restaurantInputSchema = z
  .object({
    cityId: z.string().uuid('Invalid city id.'),
    areas: z.array(z.string().trim().min(1)).max(20),
    mealTypes: z
      .array(z.enum(mealTypeEnum.enumValues))
      .min(1, 'Pick at least one meal type.')
      .max(4, 'Pick at most four meal types.')
      .refine((values) => new Set(values).size === values.length, 'Meal types must be unique.'),
    name: z.string().trim().min(1, 'Restaurant name is required.'),
    notes: z.string().trim().min(1, 'Notes are required.'),
    referredBy: referredByInputSchema,
    typeIds: z.array(z.string().uuid('Invalid type id.')).min(1, 'Pick at least one type.'),
    url: httpUrlSchema,
    googlePlaceId: z.string().trim().optional(),
    address: z.string().trim().optional(),
    latitude: optionalCoordinateSchema.refine((value) => value === null || (value >= -90 && value <= 90), {
      message: 'Latitude must be between -90 and 90.'
    }),
    longitude: optionalCoordinateSchema.refine((value) => value === null || (value >= -180 && value <= 180), {
      message: 'Longitude must be between -180 and 180.'
    }),
    locations: z
      .array(restaurantLocationInputSchema)
      .min(1, 'Add at least one map location.')
      .max(50),
    status: z.enum(restaurantStatusEnum.enumValues),
    dislikedReason: z.string().trim().optional(),
    rating: z
      .number()
      .int('Rating must be a whole number.')
      .min(1, 'Rating must be at least 1 star.')
      .max(5, 'Rating must be at most 5 stars.')
      .nullable()
  })
  .superRefine((value, ctx) => {
    if (value.status === 'disliked' && !value.dislikedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dislikedReason'],
        message: 'Disliked reason is required when status is disliked.'
      });
    }

    if (value.status !== 'disliked' && value.dislikedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dislikedReason'],
        message: 'Disliked reason can only be set when status is disliked.'
      });
    }

    if (value.status === 'untried' && value.rating !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rating'],
        message: 'Stars can only be set after trying a restaurant.'
      });
    }

    const hasOnlyOneCoordinate = (value.latitude === null) !== (value.longitude === null);
    if (hasOnlyOneCoordinate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latitude'],
        message: 'Latitude and longitude must be provided together.'
      });
    }
  });

export const parseAreas = (raw: FormDataEntryValue | null): string[] => {
  if (typeof raw !== 'string') {
    return [];
  }

  return raw
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};
