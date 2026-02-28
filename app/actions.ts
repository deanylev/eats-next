'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  cities,
  countries,
  restaurantAreas,
  restaurantMeals,
  restaurants,
  restaurantToTypes,
  restaurantTypes
} from '@/lib/schema';
import {
  cityInputSchema,
  countryInputSchema,
  parseAreas,
  restaurantInputSchema,
  restaurantTypeInputSchema
} from '@/lib/validators';

const getErrorText = (error: unknown): string => {
  if (error && typeof error === 'object' && 'issues' in error) {
    const maybeIssues = (error as { issues?: Array<{ message?: string }> }).issues;
    if (maybeIssues && maybeIssues.length > 0) {
      return maybeIssues.map((issue) => issue.message ?? 'Validation error').join(' ');
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
};

const ADMIN_ERROR_COOKIE = 'admin_error_message';
const ADMIN_SUCCESS_COOKIE = 'admin_success_message';

const bounce = (errorMessage: string): never => {
  cookies().set(ADMIN_ERROR_COOKIE, encodeURIComponent(errorMessage), {
    httpOnly: false,
    maxAge: 60,
    path: '/admin',
    sameSite: 'lax'
  });
  redirect('/admin');
};

export const createCountry = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const parsed = countryInputSchema.parse({
      name: formData.get('name')
    });

    await db.insert(countries).values({
      name: parsed.name
    });
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const updateCountry = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const countryId = String(formData.get('countryId') ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(countryId)) {
      throw new Error('Invalid country id.');
    }

    const parsed = countryInputSchema.parse({
      name: formData.get('name')
    });

    const updated = await db
      .update(countries)
      .set({
        name: parsed.name
      })
      .where(eq(countries.id, countryId))
      .returning({ id: countries.id });

    if (updated.length === 0) {
      throw new Error('Country not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const deleteCountry = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const countryId = String(formData.get('countryId') ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(countryId)) {
      throw new Error('Invalid country id.');
    }

    const deleted = await db
      .delete(countries)
      .where(eq(countries.id, countryId))
      .returning({ id: countries.id });

    if (deleted.length === 0) {
      throw new Error('Country not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const createCity = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const parsed = cityInputSchema.parse({
      name: formData.get('name'),
      countryId: formData.get('countryId')
    });

    const foundCountry = await db.query.countries.findFirst({
      where: eq(countries.id, parsed.countryId)
    });

    if (!foundCountry) {
      throw new Error('Country not found.');
    }

    await db.insert(cities).values({
      name: parsed.name,
      countryId: parsed.countryId
    });
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const updateCity = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const cityId = String(formData.get('cityId') ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cityId)) {
      throw new Error('Invalid city id.');
    }

    const parsed = cityInputSchema.parse({
      name: formData.get('name'),
      countryId: formData.get('countryId')
    });

    const foundCountry = await db.query.countries.findFirst({
      where: eq(countries.id, parsed.countryId)
    });
    if (!foundCountry) {
      throw new Error('Country not found.');
    }

    const updated = await db
      .update(cities)
      .set({
        name: parsed.name,
        countryId: parsed.countryId
      })
      .where(eq(cities.id, cityId))
      .returning({ id: cities.id });

    if (updated.length === 0) {
      throw new Error('City not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const deleteCity = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const cityId = String(formData.get('cityId') ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cityId)) {
      throw new Error('Invalid city id.');
    }

    const inUseByRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.cityId, cityId)
    });
    if (inUseByRestaurant) {
      throw new Error('Cannot delete this city because it has restaurants. Reassign or delete those restaurants first.');
    }

    const deleted = await db
      .delete(cities)
      .where(eq(cities.id, cityId))
      .returning({ id: cities.id });

    if (deleted.length === 0) {
      throw new Error('City not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const createRestaurantType = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const parsed = restaurantTypeInputSchema.parse({
      name: formData.get('name'),
      emoji: formData.get('emoji')
    });

    await db.insert(restaurantTypes).values({
      name: parsed.name,
      emoji: parsed.emoji
    });
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const updateRestaurantType = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const typeId = String(formData.get('typeId') ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(typeId)) {
      throw new Error('Invalid type id.');
    }

    const parsed = restaurantTypeInputSchema.parse({
      name: formData.get('name'),
      emoji: formData.get('emoji')
    });

    const updated = await db
      .update(restaurantTypes)
      .set({
        name: parsed.name,
        emoji: parsed.emoji
      })
      .where(eq(restaurantTypes.id, typeId))
      .returning({ id: restaurantTypes.id });

    if (updated.length === 0) {
      throw new Error('Restaurant type not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const deleteRestaurantType = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const typeId = String(formData.get('typeId') ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(typeId)) {
      throw new Error('Invalid type id.');
    }

    const inUseByRestaurant = await db.query.restaurantToTypes.findFirst({
      where: eq(restaurantToTypes.restaurantTypeId, typeId)
    });
    if (inUseByRestaurant) {
      throw new Error(
        'Cannot delete this restaurant type because it is used by restaurants. Remove it from those restaurants first.'
      );
    }

    const deleted = await db
      .delete(restaurantTypes)
      .where(eq(restaurantTypes.id, typeId))
      .returning({ id: restaurantTypes.id });

    if (deleted.length === 0) {
      throw new Error('Restaurant type not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const createRestaurant = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const parsed = restaurantInputSchema.parse({
      cityId: formData.get('cityId'),
      areas: parseAreas(formData.get('areas')),
      mealTypes: formData.getAll('mealTypes'),
      name: formData.get('name'),
      notes: formData.get('notes'),
      referredBy: formData.get('referredBy'),
      typeIds: formData.getAll('typeIds'),
      url: formData.get('url'),
      status: formData.get('status'),
      dislikedReason: formData.get('dislikedReason') ?? undefined
    });

    const foundCity = await db.query.cities.findFirst({
      where: eq(cities.id, parsed.cityId)
    });

    if (!foundCity) {
      throw new Error('City not found.');
    }

    const existingTypes = await db
      .select({ id: restaurantTypes.id })
      .from(restaurantTypes)
      .where(inArray(restaurantTypes.id, parsed.typeIds));
    const foundTypeIds = new Set(existingTypes.map((entry) => entry.id));
    const invalidTypeIds = parsed.typeIds.filter((entry) => !foundTypeIds.has(entry));

    if (invalidTypeIds.length > 0) {
      throw new Error(`Invalid restaurant type ids: ${invalidTypeIds.join(', ')}.`);
    }

    await db.transaction(async (tx) => {
      const insertedRestaurants = await tx
        .insert(restaurants)
        .values({
          cityId: parsed.cityId,
          name: parsed.name,
          notes: parsed.notes,
          referredBy: parsed.referredBy,
          url: parsed.url,
          status: parsed.status,
          triedAt: parsed.status === 'untried' ? null : new Date(),
          dislikedReason: parsed.status === 'disliked' ? parsed.dislikedReason ?? null : null
        })
        .returning({ id: restaurants.id });
      const insertedRestaurant = insertedRestaurants[0];

      if (!insertedRestaurant) {
        throw new Error('Could not create restaurant.');
      }

      if (parsed.areas.length > 0) {
        await tx.insert(restaurantAreas).values(
          parsed.areas.map((area) => ({
            restaurantId: insertedRestaurant.id,
            area
          }))
          );
      }

      await tx.insert(restaurantMeals).values(
        parsed.mealTypes.map((mealType) => ({
          restaurantId: insertedRestaurant.id,
          mealType
        }))
      );

      await tx.insert(restaurantToTypes).values(
        parsed.typeIds.map((restaurantTypeId) => ({
          restaurantId: insertedRestaurant.id,
          restaurantTypeId
        }))
      );
    });

    cookies().set(ADMIN_SUCCESS_COOKIE, encodeURIComponent('Restaurant created.'), {
      httpOnly: false,
      maxAge: 60,
      path: '/admin',
      sameSite: 'lax'
    });
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const updateRestaurant = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const restaurantId = String(formData.get('restaurantId') ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(restaurantId)) {
      throw new Error('Invalid restaurant id.');
    }

    const parsed = restaurantInputSchema.parse({
      cityId: formData.get('cityId'),
      areas: parseAreas(formData.get('areas')),
      mealTypes: formData.getAll('mealTypes'),
      name: formData.get('name'),
      notes: formData.get('notes'),
      referredBy: formData.get('referredBy'),
      typeIds: formData.getAll('typeIds'),
      url: formData.get('url'),
      status: formData.get('status'),
      dislikedReason: formData.get('dislikedReason') ?? undefined
    });

    const foundRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId)
    });
    if (!foundRestaurant) {
      throw new Error('Restaurant not found.');
    }

    const foundCity = await db.query.cities.findFirst({
      where: eq(cities.id, parsed.cityId)
    });
    if (!foundCity) {
      throw new Error('City not found.');
    }

    const uniqueTypeIds = Array.from(new Set(parsed.typeIds));
    const existingTypes = await db
      .select({ id: restaurantTypes.id })
      .from(restaurantTypes)
      .where(inArray(restaurantTypes.id, uniqueTypeIds));
    const foundTypeIds = new Set(existingTypes.map((entry) => entry.id));
    const invalidTypeIds = uniqueTypeIds.filter((entry) => !foundTypeIds.has(entry));
    if (invalidTypeIds.length > 0) {
      throw new Error(`Invalid restaurant type ids: ${invalidTypeIds.join(', ')}.`);
    }

    await db.transaction(async (tx) => {
      const nextTriedAt =
        parsed.status === 'untried'
          ? null
          : foundRestaurant.status === 'untried'
            ? new Date()
            : foundRestaurant.triedAt ?? new Date();

      await tx
        .update(restaurants)
        .set({
          cityId: parsed.cityId,
          name: parsed.name,
          notes: parsed.notes,
          referredBy: parsed.referredBy,
          url: parsed.url,
          status: parsed.status,
          triedAt: nextTriedAt,
          dislikedReason: parsed.status === 'disliked' ? parsed.dislikedReason ?? null : null
        })
        .where(eq(restaurants.id, restaurantId));

      await tx.delete(restaurantAreas).where(eq(restaurantAreas.restaurantId, restaurantId));
      await tx.delete(restaurantMeals).where(eq(restaurantMeals.restaurantId, restaurantId));
      await tx.delete(restaurantToTypes).where(eq(restaurantToTypes.restaurantId, restaurantId));

      if (parsed.areas.length > 0) {
        await tx.insert(restaurantAreas).values(
          parsed.areas.map((area) => ({
            restaurantId,
            area
          }))
        );
      }

      await tx.insert(restaurantMeals).values(
        parsed.mealTypes.map((mealType) => ({
          restaurantId,
          mealType
        }))
      );

      await tx.insert(restaurantToTypes).values(
        uniqueTypeIds.map((restaurantTypeId) => ({
          restaurantId,
          restaurantTypeId
        }))
      );
    });
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const deleteRestaurant = async (formData: FormData): Promise<void> => {
  try {
    const db = getDb();
    const restaurantId = String(formData.get('restaurantId') ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(restaurantId)) {
      throw new Error('Invalid restaurant id.');
    }

    const deleted = await db
      .delete(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .returning({ id: restaurants.id });
    if (deleted.length === 0) {
      throw new Error('Restaurant not found.');
    }
  } catch (error) {
    bounce(getErrorText(error));
  }

  redirect('/admin');
};

export const getCmsData = async () => {
  const db = getDb();
  const [countryRows, cityRows, typeRows, restaurantRows, areaRows, mealRows, restaurantTypeRows] =
    await Promise.all([
      db.select().from(countries).orderBy(asc(countries.name)),
      db
        .select({
          id: cities.id,
          name: cities.name,
          countryId: cities.countryId,
          countryName: countries.name
        })
        .from(cities)
        .innerJoin(countries, eq(cities.countryId, countries.id))
        .orderBy(asc(countries.name), asc(cities.name)),
      db.select().from(restaurantTypes).orderBy(asc(restaurantTypes.name)),
      db
        .select({
          id: restaurants.id,
          cityId: restaurants.cityId,
          name: restaurants.name,
          notes: restaurants.notes,
          referredBy: restaurants.referredBy,
          url: restaurants.url,
          status: restaurants.status,
          triedAt: restaurants.triedAt,
          dislikedReason: restaurants.dislikedReason,
          cityName: cities.name,
          countryName: countries.name
        })
        .from(restaurants)
        .innerJoin(cities, eq(restaurants.cityId, cities.id))
        .innerJoin(countries, eq(cities.countryId, countries.id))
        .orderBy(asc(countries.name), asc(cities.name), asc(restaurants.name)),
      db.select().from(restaurantAreas),
      db.select().from(restaurantMeals),
      db
        .select({
          restaurantId: restaurantToTypes.restaurantId,
          typeId: restaurantTypes.id,
          typeName: restaurantTypes.name,
          typeEmoji: restaurantTypes.emoji
        })
        .from(restaurantToTypes)
        .innerJoin(restaurantTypes, eq(restaurantToTypes.restaurantTypeId, restaurantTypes.id))
    ]);

  const areasByRestaurant = new Map<string, string[]>();
  for (const area of areaRows) {
    const existing = areasByRestaurant.get(area.restaurantId) ?? [];
    existing.push(area.area);
    areasByRestaurant.set(area.restaurantId, existing);
  }

  const mealsByRestaurant = new Map<string, string[]>();
  for (const meal of mealRows) {
    const existing = mealsByRestaurant.get(meal.restaurantId) ?? [];
    existing.push(meal.mealType);
    mealsByRestaurant.set(meal.restaurantId, existing);
  }

  const typesByRestaurant = new Map<string, Array<{ id: string; name: string; emoji: string }>>();
  for (const row of restaurantTypeRows) {
    const existing = typesByRestaurant.get(row.restaurantId) ?? [];
    existing.push({ id: row.typeId, name: row.typeName, emoji: row.typeEmoji });
    typesByRestaurant.set(row.restaurantId, existing);
  }

  const fullRestaurants = restaurantRows.map((restaurant) => ({
    ...restaurant,
    areas: areasByRestaurant.get(restaurant.id) ?? [],
    mealTypes: mealsByRestaurant.get(restaurant.id) ?? [],
    types: typesByRestaurant.get(restaurant.id) ?? []
  }));

  return {
    countries: countryRows,
    cities: cityRows,
    types: typeRows,
    restaurants: fullRestaurants
  };
};
