import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb } from '@/lib/db';
import {
  cities,
  countries,
  restaurantAreas,
  restaurantMeals,
  restaurants,
  restaurantToTypes,
  restaurantTypes,
  type RestaurantStatus
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
export type RestaurantBoardMoveInput =
  | {
      boardCategory: 'city';
      dislikedReason?: string;
      restaurantId: string;
      status: RestaurantStatus;
      targetCityId: string;
    }
  | {
      boardCategory: 'area';
      dislikedReason?: string;
      restaurantId: string;
      status: RestaurantStatus;
      targetArea: string | null;
    }
  | {
      boardCategory: 'type';
      dislikedReason?: string;
      restaurantId: string;
      status: RestaurantStatus;
      targetTypeId: string;
    };

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

export const createOrGetRestaurantTypeRecord = async (
  db: Db,
  tenantId: string,
  input: RestaurantTypeInput
): Promise<{ created: boolean; emoji: string; id: string; name: string }> => {
  const existingType = await db.query.restaurantTypes.findFirst({
    where: and(eq(restaurantTypes.tenantId, tenantId), sql`lower(${restaurantTypes.name}) = lower(${input.name})`)
  });
  if (existingType) {
    return {
      created: false,
      emoji: existingType.emoji,
      id: existingType.id,
      name: existingType.name
    };
  }

  const typeId = randomUUID();

  try {
    await db.insert(restaurantTypes).values({
      id: typeId,
      tenantId,
      name: input.name,
      emoji: input.emoji
    });
  } catch (error) {
    const duplicateType = await db.query.restaurantTypes.findFirst({
      where: and(eq(restaurantTypes.tenantId, tenantId), sql`lower(${restaurantTypes.name}) = lower(${input.name})`)
    });
    if (duplicateType) {
      return {
        created: false,
        emoji: duplicateType.emoji,
        id: duplicateType.id,
        name: duplicateType.name
      };
    }

    throw error;
  }

  return {
    created: true,
    emoji: input.emoji,
    id: typeId,
    name: input.name
  };
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

const getRestaurantAreaValues = async (db: Db, restaurantId: string): Promise<string[]> => {
  const rows = await db
    .select({ area: restaurantAreas.area })
    .from(restaurantAreas)
    .where(eq(restaurantAreas.restaurantId, restaurantId))
    .orderBy(asc(restaurantAreas.createdAt), asc(restaurantAreas.area));

  return rows.map((row) => row.area);
};

const getRestaurantTypeIds = async (db: Db, restaurantId: string): Promise<string[]> => {
  const rows = await db
    .select({ typeId: restaurantToTypes.restaurantTypeId })
    .from(restaurantToTypes)
    .where(eq(restaurantToTypes.restaurantId, restaurantId))
    .orderBy(asc(restaurantToTypes.createdAt), asc(restaurantToTypes.restaurantTypeId));

  return rows.map((row) => row.typeId);
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

export const moveRestaurantRecord = async (
  db: Db,
  tenantId: string,
  input: RestaurantBoardMoveInput
): Promise<void> => {
  const foundRestaurant = await db.query.restaurants.findFirst({
    where: and(eq(restaurants.id, input.restaurantId), eq(restaurants.tenantId, tenantId), isNull(restaurants.deletedAt))
  });
  if (!foundRestaurant) {
    fail('Restaurant not found.');
    return;
  }

  let nextCityId = foundRestaurant.cityId;
  let nextAreas = await getRestaurantAreaValues(db, input.restaurantId);
  let nextTypeIds = await getRestaurantTypeIds(db, input.restaurantId);

  if (nextTypeIds.length === 0) {
    fail('Restaurant must have at least one type.');
  }

  if (input.boardCategory === 'city') {
    const foundCity = await db.query.cities.findFirst({
      where: and(eq(cities.id, input.targetCityId), eq(cities.tenantId, tenantId))
    });
    if (!foundCity) {
      fail('City not found.');
    }

    nextCityId = input.targetCityId;
  }

  if (input.boardCategory === 'area') {
    const normalizedArea = input.targetArea?.trim() ?? null;
    const remainingAreas = nextAreas.filter((_, index) => index !== 0);
    nextAreas = normalizedArea
      ? [normalizedArea, ...remainingAreas.filter((area) => area !== normalizedArea)]
      : remainingAreas;
  }

  if (input.boardCategory === 'type') {
    const foundType = await db.query.restaurantTypes.findFirst({
      where: and(eq(restaurantTypes.id, input.targetTypeId), eq(restaurantTypes.tenantId, tenantId))
    });
    if (!foundType) {
      fail('Restaurant type not found.');
    }

    const remainingTypeIds = nextTypeIds.filter((_, index) => index !== 0);
    nextTypeIds = [input.targetTypeId, ...remainingTypeIds.filter((typeId) => typeId !== input.targetTypeId)];
  }

  const nextDislikedReason =
    input.status === 'disliked'
      ? input.dislikedReason?.trim() || foundRestaurant.dislikedReason?.trim() || null
      : null;
  if (input.status === 'disliked' && !nextDislikedReason) {
    fail('Disliked reason is required when moving a restaurant to Not Recommended.');
  }

  const duplicateRestaurant = await db.query.restaurants.findFirst({
    where: and(
      ne(restaurants.id, input.restaurantId),
      eq(restaurants.cityId, nextCityId),
      eq(restaurants.tenantId, tenantId),
      isNull(restaurants.deletedAt),
      sql`lower(${restaurants.name}) = lower(${foundRestaurant.name})`
    )
  });
  if (duplicateRestaurant) {
    fail('A restaurant with this name already exists in this city.');
  }

  const nextTriedAt =
    input.status === 'untried'
      ? null
      : foundRestaurant.status === 'untried'
        ? new Date()
        : foundRestaurant.triedAt ?? new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(restaurants)
      .set({
        cityId: nextCityId,
        status: input.status,
        triedAt: nextTriedAt,
        dislikedReason: nextDislikedReason
      })
      .where(and(eq(restaurants.id, input.restaurantId), eq(restaurants.tenantId, tenantId), isNull(restaurants.deletedAt)));

    if (input.boardCategory === 'area') {
      await tx.delete(restaurantAreas).where(eq(restaurantAreas.restaurantId, input.restaurantId));

      if (nextAreas.length > 0) {
        await tx.insert(restaurantAreas).values(
          nextAreas.map((area) => ({
            id: randomUUID(),
            restaurantId: input.restaurantId,
            area
          }))
        );
      }
    }

    if (input.boardCategory === 'type') {
      await tx.delete(restaurantToTypes).where(eq(restaurantToTypes.restaurantId, input.restaurantId));
      await tx.insert(restaurantToTypes).values(
        nextTypeIds.map((restaurantTypeId) => ({
          restaurantId: input.restaurantId,
          restaurantTypeId
        }))
      );
    }
  });
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

export const permanentlyDeleteRestaurantRecord = async (
  db: Db,
  tenantId: string,
  restaurantId: string
): Promise<void> => {
  const foundRestaurant = await db.query.restaurants.findFirst({
    where: and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId), isNotNull(restaurants.deletedAt))
  });
  if (!foundRestaurant) {
    fail('Deleted restaurant not found.');
  }

  await db.delete(restaurants).where(and(eq(restaurants.id, restaurantId), eq(restaurants.tenantId, tenantId)));
};
