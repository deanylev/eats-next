import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
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
  restaurantInputSchema,
  restaurantTypeInputSchema
} from '@/lib/validators';

type Db = ReturnType<typeof getDb>;

export type CountryInput = z.infer<typeof countryInputSchema>;
export type CityInput = z.infer<typeof cityInputSchema> & {
  setAsDefault: boolean;
};
export type RestaurantTypeInput = z.infer<typeof restaurantTypeInputSchema>;
export type RestaurantInput = z.infer<typeof restaurantInputSchema>;

const fail = (message: string): never => {
  throw new Error(message);
};

const ensureCountryBelongsToTenant = async (db: Db, tenantId: string, countryId: string): Promise<void> => {
  const foundCountry = await db.query.countries.findFirst({
    where: and(eq(countries.id, countryId), eq(countries.tenantId, tenantId))
  });

  if (!foundCountry) {
    fail('Country not found.');
  }
};

export const createCountryRecord = async (db: Db, tenantId: string, input: CountryInput): Promise<void> => {
  await db.insert(countries).values({
    id: randomUUID(),
    tenantId,
    name: input.name
  });
};

export const updateCountryRecord = async (
  db: Db,
  tenantId: string,
  countryId: string,
  input: CountryInput
): Promise<void> => {
  const foundCountry = await db.query.countries.findFirst({
    where: and(eq(countries.id, countryId), eq(countries.tenantId, tenantId))
  });
  if (!foundCountry) {
    fail('Country not found.');
  }

  await db
    .update(countries)
    .set({
      name: input.name
    })
    .where(and(eq(countries.id, countryId), eq(countries.tenantId, tenantId)));
};

export const deleteCountryRecord = async (db: Db, tenantId: string, countryId: string): Promise<void> => {
  const foundCountry = await db.query.countries.findFirst({
    where: and(eq(countries.id, countryId), eq(countries.tenantId, tenantId))
  });
  if (!foundCountry) {
    fail('Country not found.');
  }

  await db.delete(countries).where(and(eq(countries.id, countryId), eq(countries.tenantId, tenantId)));
};

export const createCityRecord = async (db: Db, tenantId: string, input: CityInput): Promise<void> => {
  await ensureCountryBelongsToTenant(db, tenantId, input.countryId);

  await db.transaction(async (tx) => {
    if (input.setAsDefault) {
      await tx.update(cities).set({ isDefault: false }).where(eq(cities.tenantId, tenantId));
    }

    await tx.insert(cities).values({
      id: randomUUID(),
      tenantId,
      name: input.name,
      countryId: input.countryId,
      isDefault: input.setAsDefault
    });
  });
};

export const updateCityRecord = async (
  db: Db,
  tenantId: string,
  cityId: string,
  input: CityInput
): Promise<void> => {
  await ensureCountryBelongsToTenant(db, tenantId, input.countryId);
  const foundCity = await db.query.cities.findFirst({
    where: and(eq(cities.id, cityId), eq(cities.tenantId, tenantId))
  });
  if (!foundCity) {
    fail('City not found.');
  }

  await db.transaction(async (tx) => {
    if (input.setAsDefault) {
      await tx.update(cities).set({ isDefault: false }).where(eq(cities.tenantId, tenantId));
    }

    await tx
      .update(cities)
      .set({
        name: input.name,
        tenantId,
        countryId: input.countryId,
        ...(input.setAsDefault ? { isDefault: true } : {})
      })
      .where(and(eq(cities.id, cityId), eq(cities.tenantId, tenantId)));
  });
};

export const deleteCityRecord = async (db: Db, tenantId: string, cityId: string): Promise<void> => {
  const foundCity = await db.query.cities.findFirst({
    where: and(eq(cities.id, cityId), eq(cities.tenantId, tenantId))
  });
  if (!foundCity) {
    fail('City not found.');
  }

  const inUseByRestaurant = await db.query.restaurants.findFirst({
    where: and(eq(restaurants.cityId, cityId), eq(restaurants.tenantId, tenantId))
  });
  if (inUseByRestaurant) {
    fail('Cannot delete this city because it has restaurants. Reassign or delete those restaurants first.');
  }

  await db.delete(cities).where(and(eq(cities.id, cityId), eq(cities.tenantId, tenantId)));
};

export const createRestaurantTypeRecord = async (
  db: Db,
  tenantId: string,
  input: RestaurantTypeInput
): Promise<void> => {
  await db.insert(restaurantTypes).values({
    id: randomUUID(),
    tenantId,
    name: input.name,
    emoji: input.emoji
  });
};

export const updateRestaurantTypeRecord = async (
  db: Db,
  tenantId: string,
  typeId: string,
  input: RestaurantTypeInput
): Promise<void> => {
  const foundType = await db.query.restaurantTypes.findFirst({
    where: and(eq(restaurantTypes.id, typeId), eq(restaurantTypes.tenantId, tenantId))
  });
  if (!foundType) {
    fail('Restaurant type not found.');
  }

  await db
    .update(restaurantTypes)
    .set({
      name: input.name,
      emoji: input.emoji
    })
    .where(and(eq(restaurantTypes.id, typeId), eq(restaurantTypes.tenantId, tenantId)));
};

export const deleteRestaurantTypeRecord = async (db: Db, tenantId: string, typeId: string): Promise<void> => {
  const foundType = await db.query.restaurantTypes.findFirst({
    where: and(eq(restaurantTypes.id, typeId), eq(restaurantTypes.tenantId, tenantId))
  });
  if (!foundType) {
    fail('Restaurant type not found.');
  }

  const [inUseByRestaurant] = await db
    .select({ restaurantId: restaurantToTypes.restaurantId })
    .from(restaurantToTypes)
    .where(
      and(
        eq(restaurantToTypes.restaurantTypeId, typeId),
        sql`exists (
          select 1 from ${restaurants}
          where ${restaurants.id} = ${restaurantToTypes.restaurantId}
            and ${restaurants.tenantId} = ${tenantId}
        )`
      )
    )
    .limit(1);
  if (inUseByRestaurant) {
    fail('Cannot delete this restaurant type because it is used by restaurants. Remove it from those restaurants first.');
  }

  await db.delete(restaurantTypes).where(and(eq(restaurantTypes.id, typeId), eq(restaurantTypes.tenantId, tenantId)));
};

const validateRestaurantRefs = async (db: Db, tenantId: string, input: RestaurantInput): Promise<void> => {
  const foundCity = await db.query.cities.findFirst({
    where: and(eq(cities.id, input.cityId), eq(cities.tenantId, tenantId))
  });
  if (!foundCity) {
    fail('City not found.');
  }

  const uniqueTypeIds = Array.from(new Set(input.typeIds));
  const existingTypes = await db
    .select({ id: restaurantTypes.id })
    .from(restaurantTypes)
    .where(eq(restaurantTypes.tenantId, tenantId));
  const foundTypeIds = new Set(existingTypes.map((entry) => entry.id));
  const invalidTypeIds = uniqueTypeIds.filter((entry) => !foundTypeIds.has(entry));
  if (invalidTypeIds.length > 0) {
    fail('One or more restaurant types are invalid.');
  }
};

export const createRestaurantRecord = async (db: Db, tenantId: string, input: RestaurantInput): Promise<string> => {
  await validateRestaurantRefs(db, tenantId, input);

  const duplicateRestaurant = await db.query.restaurants.findFirst({
    where: and(
      eq(restaurants.cityId, input.cityId),
      eq(restaurants.tenantId, tenantId),
      isNull(restaurants.deletedAt),
      sql`lower(${restaurants.name}) = lower(${input.name})`
    )
  });
  if (duplicateRestaurant) {
    fail('A restaurant with this name already exists in this city.');
  }

  const insertedRestaurantId = await db.transaction(async (tx) => {
    const restaurantId = randomUUID();
    const insertedRestaurants = await tx
      .insert(restaurants)
      .values({
        id: restaurantId,
        cityId: input.cityId,
        tenantId,
        name: input.name,
        notes: input.notes,
        referredBy: input.referredBy ?? '',
        url: input.url,
        status: input.status,
        triedAt: input.status === 'untried' ? null : new Date(),
        dislikedReason: input.status === 'disliked' ? input.dislikedReason ?? null : null
      })
      .returning({ id: restaurants.id });
    const insertedRestaurant = insertedRestaurants[0];

    if (!insertedRestaurant) {
      fail('Could not create restaurant.');
    }

    if (input.areas.length > 0) {
      await tx.insert(restaurantAreas).values(
        input.areas.map((area) => ({
          id: randomUUID(),
          restaurantId: restaurantId,
          area
        }))
      );
    }

    await tx.insert(restaurantMeals).values(
      input.mealTypes.map((mealType) => ({
        restaurantId: restaurantId,
        mealType
      }))
    );

    await tx.insert(restaurantToTypes).values(
      Array.from(new Set(input.typeIds)).map((restaurantTypeId) => ({
        restaurantId: restaurantId,
        restaurantTypeId
      }))
    );

    return restaurantId;
  });

  return insertedRestaurantId;
};

export const updateRestaurantRecord = async (
  db: Db,
  tenantId: string,
  restaurantId: string,
  input: RestaurantInput
): Promise<string> => {
  const foundRestaurant = await db.query.restaurants.findFirst({
    where: and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId))
  });
  if (!foundRestaurant) {
    fail('Restaurant not found.');
  }
  const existingRestaurant = foundRestaurant ?? fail('Restaurant not found.');

  await validateRestaurantRefs(db, tenantId, input);

  const uniqueTypeIds = Array.from(new Set(input.typeIds));
  const duplicateRestaurant = await db.query.restaurants.findFirst({
    where: and(
      ne(restaurants.id, restaurantId),
      eq(restaurants.cityId, input.cityId),
      eq(restaurants.tenantId, tenantId),
      isNull(restaurants.deletedAt),
      sql`lower(${restaurants.name}) = lower(${input.name})`
    )
  });
  if (duplicateRestaurant) {
    fail('A restaurant with this name already exists in this city.');
  }

  await db.transaction(async (tx) => {
    const nextTriedAt =
      input.status === 'untried'
        ? null
        : existingRestaurant.status === 'untried'
          ? new Date()
          : existingRestaurant.triedAt ?? new Date();

    await tx
      .update(restaurants)
      .set({
        cityId: input.cityId,
        tenantId,
        name: input.name,
        notes: input.notes,
        referredBy: input.referredBy ?? '',
        url: input.url,
        status: input.status,
        triedAt: nextTriedAt,
        dislikedReason: input.status === 'disliked' ? input.dislikedReason ?? null : null
      })
      .where(and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId)));

    await tx.delete(restaurantAreas).where(eq(restaurantAreas.restaurantId, restaurantId));
    await tx.delete(restaurantMeals).where(eq(restaurantMeals.restaurantId, restaurantId));
    await tx.delete(restaurantToTypes).where(eq(restaurantToTypes.restaurantId, restaurantId));

    if (input.areas.length > 0) {
      await tx.insert(restaurantAreas).values(
        input.areas.map((area) => ({
          id: randomUUID(),
          restaurantId,
          area
        }))
      );
    }

    await tx.insert(restaurantMeals).values(
      input.mealTypes.map((mealType) => ({
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

  return restaurantId;
};

export const softDeleteRestaurantRecord = async (db: Db, tenantId: string, restaurantId: string): Promise<void> => {
  const foundRestaurant = await db.query.restaurants.findFirst({
    where: and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId), isNull(restaurants.deletedAt))
  });
  if (!foundRestaurant) {
    fail('Restaurant not found.');
  }

  await db
    .update(restaurants)
    .set({ deletedAt: new Date() })
    .where(and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId), isNull(restaurants.deletedAt)));
};

export const restoreRestaurantRecord = async (db: Db, tenantId: string, restaurantId: string): Promise<void> => {
  const foundRestaurant = await db.query.restaurants.findFirst({
    where: and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId), isNotNull(restaurants.deletedAt))
  });
  if (!foundRestaurant) {
    fail('Deleted restaurant not found.');
  }

  await db
    .update(restaurants)
    .set({ deletedAt: null })
    .where(and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId), isNotNull(restaurants.deletedAt)));
};
