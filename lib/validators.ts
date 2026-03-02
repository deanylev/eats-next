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
const googleMapsHostnames = ['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl'];

const isGoogleMapsUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const isGoogleHost = googleMapsHostnames.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`)
    );
    if (!isGoogleHost) {
      return false;
    }

    return host === 'maps.app.goo.gl' || path === '/maps' || path.startsWith('/maps/');
  } catch {
    return false;
  }
};

const emojiRegex = /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u;

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
    status: z.enum(restaurantStatusEnum.enumValues),
    dislikedReason: z.string().trim().optional()
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

    const hasLessThanTwoAreas = value.areas.length < 2;
    const googleMaps = isGoogleMapsUrl(value.url);

    if (hasLessThanTwoAreas && !googleMaps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'When there are fewer than two areas, URL must be a Google Maps URL.'
      });
    }

    if (!hasLessThanTwoAreas && googleMaps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'When there are two or more areas, URL must not be a Google Maps URL.'
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
