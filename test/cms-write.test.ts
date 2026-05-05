import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import {
  createCityRecord,
  createCountryRecord,
  createOrGetCityRecord,
  createOrGetCountryRecord,
  createRestaurantRecord,
  createOrGetRestaurantTypeRecord,
  createRestaurantTypeRecord,
  deleteCityRecord,
  deleteCountryRecord,
  moveRestaurantRecord,
  deleteRestaurantTypeRecord,
  restoreRestaurantRecord,
  softDeleteRestaurantRecord,
  updateCityRecord,
  updateCountryRecord,
  updateRestaurantRecord
} from '../lib/cms-write';
import {
  cities,
  countries,
  restaurantAreas,
  restaurantMeals,
  restaurants,
  restaurantToTypes,
  restaurantTypes,
  tenants
} from '../lib/schema';
import { createTestDb, hasTestDatabase } from './helpers/test-db';

const buildRestaurantInput = (overrides?: Partial<Parameters<typeof createRestaurantRecord>[2]>) => ({
  cityId: overrides?.cityId ?? randomUUID(),
  areas: overrides?.areas ?? ['CBD'],
  mealTypes: overrides?.mealTypes ?? ['lunch'],
  name: overrides?.name ?? 'Kelso',
  notes: overrides?.notes ?? 'Good sandwiches',
  referredBy: overrides?.referredBy,
  typeIds: overrides?.typeIds ?? [randomUUID()],
  url: overrides?.url ?? 'https://www.google.com/maps/place/Kelso',
  googlePlaceId: overrides?.googlePlaceId,
  address: overrides?.address,
  latitude: overrides?.latitude ?? null,
  longitude: overrides?.longitude ?? null,
  locations: overrides?.locations ?? [{
    address: '123 Smith St, Fitzroy',
    googleMapsUrl: 'https://maps.google.com/?cid=11885663895765773631',
    googlePlaceId: 'places/abc123',
    label: 'Kelso Fitzroy',
    latitude: -37.8,
    longitude: 144.97
  }],
  status: overrides?.status ?? 'untried',
  dislikedReason: overrides?.dislikedReason,
  rating: overrides?.rating ?? null
});

const dbTest = hasTestDatabase ? test : test.skip;

const createTenantFixture = async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();
  const cityId = randomUUID();
  const typeId = randomUUID();

  await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
  await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });
  await db.insert(cities).values({ id: cityId, tenantId, countryId, name: 'Melbourne', isDefault: true });
  await db.insert(restaurantTypes).values({ id: typeId, tenantId, name: 'Sandwiches', emoji: '🥪' });

  return {
    db,
    cleanup,
    tenantId,
    countryId,
    cityId,
    typeId
  };
};

dbTest('createCountryRecord creates a tenant-scoped country', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await createCountryRecord(db, tenantId, { name: 'Japan' });

    const savedCountries = await db.select().from(countries).where(eq(countries.tenantId, tenantId));
    assert.equal(savedCountries.length, 1);
    assert.equal(savedCountries[0]?.name, 'Japan');
  } finally {
    await cleanup();
  }
});

dbTest('updateCountryRecord updates the country name for the current tenant only', async () => {
  const { db, cleanup, tenantId, countryId } = await createTenantFixture();

  try {
    await updateCountryRecord(db, tenantId, countryId, { name: 'Japan' });

    const savedCountry = await db.query.countries.findFirst({
      where: eq(countries.id, countryId)
    });
    assert.equal(savedCountry?.name, 'Japan');
  } finally {
    await cleanup();
  }
});

dbTest('deleteCountryRecord removes a country when it belongs to the current tenant', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Japan' });

    await deleteCountryRecord(db, tenantId, countryId);

    const savedCountry = await db.query.countries.findFirst({
      where: eq(countries.id, countryId)
    });
    assert.equal(savedCountry, undefined);
  } finally {
    await cleanup();
  }
});

dbTest('createOrGetCountryRecord reuses an existing country case-insensitively', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });

    const firstResult = await createOrGetCountryRecord(db, tenantId, { name: 'Japan' });
    const secondResult = await createOrGetCountryRecord(db, tenantId, { name: 'jApAn' });

    const savedCountries = await db.select().from(countries).where(eq(countries.tenantId, tenantId));

    assert.equal(firstResult.created, true);
    assert.equal(secondResult.created, false);
    assert.equal(secondResult.id, firstResult.id);
    assert.equal(secondResult.name, 'Japan');
    assert.equal(savedCountries.length, 1);
  } finally {
    await cleanup();
  }
});

dbTest('createRestaurantTypeRecord creates a tenant-scoped restaurant type', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await createRestaurantTypeRecord(db, tenantId, { name: 'Steak', emoji: '🥩' });

    const savedTypes = await db.select().from(restaurantTypes).where(eq(restaurantTypes.tenantId, tenantId));
    assert.equal(savedTypes.length, 1);
    assert.equal(savedTypes[0]?.name, 'Steak');
    assert.equal(savedTypes[0]?.emoji, '🥩');
  } finally {
    await cleanup();
  }
});

dbTest('createOrGetRestaurantTypeRecord reuses an existing type case-insensitively', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });

    const firstResult = await createOrGetRestaurantTypeRecord(db, tenantId, { name: 'Steak', emoji: '🥩' });
    const secondResult = await createOrGetRestaurantTypeRecord(db, tenantId, { name: 'sTeAk', emoji: '🍖' });

    const savedTypes = await db.select().from(restaurantTypes).where(eq(restaurantTypes.tenantId, tenantId));

    assert.equal(firstResult.created, true);
    assert.equal(secondResult.created, false);
    assert.equal(secondResult.id, firstResult.id);
    assert.equal(secondResult.name, 'Steak');
    assert.equal(secondResult.emoji, '🥩');
    assert.equal(savedTypes.length, 1);
  } finally {
    await cleanup();
  }
});

dbTest('createRestaurantRecord keeps referredBy blank when omitted', async () => {
  const { db, cleanup, tenantId, cityId, typeId } = await createTenantFixture();

  try {
    const restaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({
        cityId,
        typeIds: [typeId],
        referredBy: undefined
      })
    );

    const savedRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId)
    });
    assert.equal(savedRestaurant?.referredBy, '');
  } finally {
    await cleanup();
  }
});

dbTest('createCityRecord resets the previous default city in the same tenant', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });

    await createCityRecord(db, tenantId, {
      name: 'Melbourne',
      countryId,
      setAsDefault: true
    });
    await createCityRecord(db, tenantId, {
      name: 'Sydney',
      countryId,
      setAsDefault: true
    });

    const allCities = await db.select().from(cities).where(eq(cities.tenantId, tenantId));
    const melbourne = allCities.find((city) => city.name === 'Melbourne');
    const sydney = allCities.find((city) => city.name === 'Sydney');

    assert.equal(melbourne?.isDefault, false);
    assert.equal(sydney?.isDefault, true);
  } finally {
    await cleanup();
  }
});

dbTest('updateCityRecord can promote an existing city to default', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();
  const melbourneId = randomUUID();
  const sydneyId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });
    await db.insert(cities).values([
      { id: melbourneId, tenantId, countryId, name: 'Melbourne', isDefault: true },
      { id: sydneyId, tenantId, countryId, name: 'Sydney', isDefault: false }
    ]);

    await updateCityRecord(db, tenantId, sydneyId, {
      name: 'Sydney',
      countryId,
      setAsDefault: true
    });

    const allCities = await db.select().from(cities).where(eq(cities.tenantId, tenantId));
    const melbourne = allCities.find((city) => city.id === melbourneId);
    const sydney = allCities.find((city) => city.id === sydneyId);

    assert.equal(melbourne?.isDefault, false);
    assert.equal(sydney?.isDefault, true);
  } finally {
    await cleanup();
  }
});

dbTest('createOrGetCityRecord reuses an existing city case-insensitively within the same country', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Japan' });

    const firstResult = await createOrGetCityRecord(db, tenantId, { countryId, name: 'Tokyo' });
    const secondResult = await createOrGetCityRecord(db, tenantId, { countryId, name: 'tOkYo' });

    const savedCities = await db.select().from(cities).where(eq(cities.tenantId, tenantId));

    assert.equal(firstResult.created, true);
    assert.equal(secondResult.created, false);
    assert.equal(secondResult.id, firstResult.id);
    assert.equal(secondResult.name, 'Tokyo');
    assert.equal(secondResult.countryId, countryId);
    assert.equal(secondResult.countryName, 'Japan');
    assert.equal(savedCities.length, 1);
  } finally {
    await cleanup();
  }
});

dbTest('createRestaurantRecord inserts restaurant areas, meals, and type links', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();
  const cityId = randomUUID();
  const typeId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });
    await db.insert(cities).values({ id: cityId, tenantId, countryId, name: 'Melbourne', isDefault: true });
    await db.insert(restaurantTypes).values({ id: typeId, tenantId, name: 'Sandwiches', emoji: '🥪' });

    const restaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({
        cityId,
        typeIds: [typeId],
        areas: ['CBD', 'Carlton'],
        mealTypes: ['lunch', 'dinner'],
        url: 'https://kelso.example.com/'
      })
    );

    const savedRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId)
    });
    const savedAreas = await db
      .select()
      .from(restaurantAreas)
      .where(eq(restaurantAreas.restaurantId, restaurantId))
      .orderBy(asc(restaurantAreas.createdAt), asc(restaurantAreas.area));
    const savedMeals = await db.select().from(restaurantMeals).where(eq(restaurantMeals.restaurantId, restaurantId));
    const savedTypes = await db
      .select()
      .from(restaurantToTypes)
      .where(eq(restaurantToTypes.restaurantId, restaurantId))
      .orderBy(asc(restaurantToTypes.createdAt), asc(restaurantToTypes.restaurantTypeId));

    assert.equal(savedRestaurant?.name, 'Kelso');
    assert.equal(savedRestaurant?.triedAt, null);
    assert.deepEqual(savedAreas.map((entry) => entry.area).sort(), ['CBD', 'Carlton']);
    assert.deepEqual(savedMeals.map((entry) => entry.mealType).sort(), ['dinner', 'lunch']);
    assert.deepEqual(savedTypes.map((entry) => entry.restaurantTypeId), [typeId]);
  } finally {
    await cleanup();
  }
});

dbTest('createRestaurantRecord rejects duplicate active restaurant names within a city', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();
  const cityId = randomUUID();
  const typeId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });
    await db.insert(cities).values({ id: cityId, tenantId, countryId, name: 'Melbourne', isDefault: true });
    await db.insert(restaurantTypes).values({ id: typeId, tenantId, name: 'Sandwiches', emoji: '🥪' });

    await createRestaurantRecord(db, tenantId, buildRestaurantInput({ cityId, typeIds: [typeId], name: 'Kelso' }));

    await assert.rejects(
      () => createRestaurantRecord(db, tenantId, buildRestaurantInput({ cityId, typeIds: [typeId], name: 'kElSo' })),
      /already exists/
    );
  } finally {
    await cleanup();
  }
});

dbTest('updateRestaurantRecord updates associations and manages triedAt transitions', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();
  const cityId = randomUUID();
  const firstTypeId = randomUUID();
  const secondTypeId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });
    await db.insert(cities).values({ id: cityId, tenantId, countryId, name: 'Melbourne', isDefault: true });
    await db.insert(restaurantTypes).values([
      { id: firstTypeId, tenantId, name: 'Sandwiches', emoji: '🥪' },
      { id: secondTypeId, tenantId, name: 'Steak', emoji: '🥩' }
    ]);

    const restaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({ cityId, typeIds: [firstTypeId], areas: ['CBD'], name: 'Kelso' })
    );

    await updateRestaurantRecord(
      db,
      tenantId,
      restaurantId,
      buildRestaurantInput({
        cityId,
        typeIds: [secondTypeId, secondTypeId],
        areas: ['CBD', 'Fitzroy'],
        mealTypes: ['dinner'],
        name: 'Kelso Updated',
        status: 'liked',
        url: 'https://kelso.example.com/'
      })
    );

    const likedRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId)
    });
    const updatedAreas = await db.select().from(restaurantAreas).where(eq(restaurantAreas.restaurantId, restaurantId));
    const updatedTypes = await db.select().from(restaurantToTypes).where(eq(restaurantToTypes.restaurantId, restaurantId));

    assert.equal(likedRestaurant?.name, 'Kelso Updated');
    assert.notEqual(likedRestaurant?.triedAt, null);
    assert.deepEqual(updatedAreas.map((entry) => entry.area).sort(), ['CBD', 'Fitzroy']);
    assert.deepEqual(updatedTypes.map((entry) => entry.restaurantTypeId), [secondTypeId]);

    await updateRestaurantRecord(
      db,
      tenantId,
      restaurantId,
      buildRestaurantInput({
        cityId,
        typeIds: [secondTypeId],
        areas: ['CBD'],
        name: 'Kelso Updated',
        status: 'untried',
        url: 'https://www.google.com/maps/place/Kelso'
      })
    );

    const untriedRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId)
    });
    assert.equal(untriedRestaurant?.triedAt, null);
  } finally {
    await cleanup();
  }
});

dbTest('updateRestaurantRecord sets dislikedReason and preserves triedAt when moving from liked to disliked', async () => {
  const { db, cleanup, tenantId, cityId, typeId } = await createTenantFixture();

  try {
    const restaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({
        cityId,
        typeIds: [typeId],
        status: 'liked',
        areas: ['CBD', 'Fitzroy'],
        url: 'https://kelso.example.com/'
      })
    );

    const initiallyLiked = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId)
    });

    await updateRestaurantRecord(
      db,
      tenantId,
      restaurantId,
      buildRestaurantInput({
        cityId,
        typeIds: [typeId],
        status: 'disliked',
        dislikedReason: 'Too salty',
        areas: ['CBD', 'Fitzroy'],
        url: 'https://kelso.example.com/'
      })
    );

    const dislikedRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId)
    });

    assert.equal(dislikedRestaurant?.dislikedReason, 'Too salty');
    assert.equal(dislikedRestaurant?.triedAt?.toISOString(), initiallyLiked?.triedAt?.toISOString());
  } finally {
    await cleanup();
  }
});

dbTest('moveRestaurantRecord updates status and primary area while preserving secondary areas', async () => {
  const { db, cleanup, tenantId, cityId, typeId } = await createTenantFixture();

  try {
    const restaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({
        areas: ['CBD', 'Fitzroy'],
        cityId,
        typeIds: [typeId],
        url: 'https://kelso.example.com/'
      })
    );

    await moveRestaurantRecord(db, tenantId, {
      boardCategory: 'area',
      restaurantId,
      status: 'liked',
      targetArea: 'Carlton'
    });

    const savedRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId)
    });
    const savedAreas = await db.select().from(restaurantAreas).where(eq(restaurantAreas.restaurantId, restaurantId));

    assert.equal(savedRestaurant?.status, 'liked');
    assert.notEqual(savedRestaurant?.triedAt, null);
    assert.deepEqual(savedAreas.map((entry) => entry.area), ['Carlton', 'Fitzroy']);
  } finally {
    await cleanup();
  }
});

dbTest('moveRestaurantRecord updates primary type while preserving secondary types', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();
  const cityId = randomUUID();
  const firstTypeId = randomUUID();
  const secondTypeId = randomUUID();
  const thirdTypeId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });
    await db.insert(cities).values({ id: cityId, tenantId, countryId, name: 'Melbourne', isDefault: true });
    await db.insert(restaurantTypes).values([
      { id: firstTypeId, tenantId, name: 'Sandwiches', emoji: '🥪' },
      { id: secondTypeId, tenantId, name: 'Burgers', emoji: '🍔' },
      { id: thirdTypeId, tenantId, name: 'Ramen', emoji: '🍜' }
    ]);

    const restaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({
        areas: ['CBD', 'Fitzroy'],
        cityId,
        typeIds: [firstTypeId, secondTypeId],
        url: 'https://kelso.example.com/'
      })
    );
    const originalTypes = await db
      .select()
      .from(restaurantToTypes)
      .where(eq(restaurantToTypes.restaurantId, restaurantId))
      .orderBy(asc(restaurantToTypes.createdAt), asc(restaurantToTypes.restaurantTypeId));

    await moveRestaurantRecord(db, tenantId, {
      boardCategory: 'type',
      restaurantId,
      status: 'liked',
      targetTypeId: thirdTypeId
    });

    const savedTypes = await db
      .select()
      .from(restaurantToTypes)
      .where(eq(restaurantToTypes.restaurantId, restaurantId))
      .orderBy(asc(restaurantToTypes.createdAt), asc(restaurantToTypes.restaurantTypeId));
    assert.equal(savedTypes.length, 2);
    assert.deepEqual(
      [...savedTypes.map((entry) => entry.restaurantTypeId)].sort(),
      [thirdTypeId, originalTypes[1]?.restaurantTypeId].sort()
    );
  } finally {
    await cleanup();
  }
});

dbTest('moveRestaurantRecord requires a disliked reason when moving to disliked', async () => {
  const { db, cleanup, tenantId, cityId, typeId } = await createTenantFixture();

  try {
    const restaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({
        cityId,
        typeIds: [typeId]
      })
    );

    await assert.rejects(
      () =>
        moveRestaurantRecord(db, tenantId, {
          boardCategory: 'area',
          restaurantId,
          status: 'disliked',
          targetArea: 'CBD'
        }),
      /Disliked reason is required/
    );
  } finally {
    await cleanup();
  }
});

dbTest('moveRestaurantRecord updates notes and clears dislikedReason when moving from disliked to liked', async () => {
  const { db, cleanup, tenantId, cityId, typeId } = await createTenantFixture();

  try {
    const restaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({
        cityId,
        dislikedReason: 'Too salty',
        notes: 'Old notes',
        status: 'disliked',
        typeIds: [typeId]
      })
    );

    await moveRestaurantRecord(db, tenantId, {
      boardCategory: 'area',
      notes: 'New notes',
      restaurantId,
      status: 'liked',
      targetArea: 'CBD'
    });

    const savedRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId)
    });

    assert.equal(savedRestaurant?.status, 'liked');
    assert.equal(savedRestaurant?.notes, 'New notes');
    assert.equal(savedRestaurant?.dislikedReason, null);
  } finally {
    await cleanup();
  }
});

dbTest('softDeleteRestaurantRecord allows recreating the same restaurant name and restoreRestaurantRecord revives it', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();
  const cityId = randomUUID();
  const typeId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });
    await db.insert(cities).values({ id: cityId, tenantId, countryId, name: 'Melbourne', isDefault: true });
    await db.insert(restaurantTypes).values({ id: typeId, tenantId, name: 'Sandwiches', emoji: '🥪' });

    const deletedRestaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({ cityId, typeIds: [typeId], name: 'Kelso' })
    );

    await softDeleteRestaurantRecord(db, tenantId, deletedRestaurantId);

    const replacementRestaurantId = await createRestaurantRecord(
      db,
      tenantId,
      buildRestaurantInput({ cityId, typeIds: [typeId], name: 'Kelso' })
    );

    const replacementRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, replacementRestaurantId)
    });
    assert.equal(replacementRestaurant?.deletedAt, null);

    await db.update(restaurants).set({ deletedAt: new Date() }).where(eq(restaurants.id, replacementRestaurantId));
    await restoreRestaurantRecord(db, tenantId, deletedRestaurantId);

    const restoredRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.id, deletedRestaurantId)
    });
    assert.equal(restoredRestaurant?.deletedAt, null);
  } finally {
    await cleanup();
  }
});

dbTest('deleteCityRecord rejects deleting a city that still has restaurants', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();
  const cityId = randomUUID();
  const typeId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });
    await db.insert(cities).values({ id: cityId, tenantId, countryId, name: 'Melbourne', isDefault: true });
    await db.insert(restaurantTypes).values({ id: typeId, tenantId, name: 'Sandwiches', emoji: '🥪' });
    await createRestaurantRecord(db, tenantId, buildRestaurantInput({ cityId, typeIds: [typeId] }));

    await assert.rejects(() => deleteCityRecord(db, tenantId, cityId), /has restaurants/);
  } finally {
    await cleanup();
  }
});

dbTest('deleteRestaurantTypeRecord rejects deleting a type still used by a restaurant', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = randomUUID();
  const countryId = randomUUID();
  const cityId = randomUUID();
  const typeId = randomUUID();

  try {
    await db.insert(tenants).values({ id: tenantId, displayName: 'Dean', isRoot: false });
    await db.insert(countries).values({ id: countryId, tenantId, name: 'Australia' });
    await db.insert(cities).values({ id: cityId, tenantId, countryId, name: 'Melbourne', isDefault: true });
    await db.insert(restaurantTypes).values({ id: typeId, tenantId, name: 'Sandwiches', emoji: '🥪' });
    await createRestaurantRecord(db, tenantId, buildRestaurantInput({ cityId, typeIds: [typeId] }));

    await assert.rejects(() => deleteRestaurantTypeRecord(db, tenantId, typeId), /used by restaurants/);
  } finally {
    await cleanup();
  }
});

dbTest('tenant-scoped operations do not allow cross-tenant updates or deletes', async () => {
  const { db, cleanup, tenantId, countryId, cityId, typeId } = await createTenantFixture();
  const otherTenantId = randomUUID();
  const otherCountryId = randomUUID();

  try {
    await db.insert(tenants).values({ id: otherTenantId, displayName: 'Other', isRoot: false });
    await db.insert(countries).values({ id: otherCountryId, tenantId: otherTenantId, name: 'Italy' });

    await assert.rejects(() => updateCountryRecord(db, otherTenantId, countryId, { name: 'Spain' }), /Country not found/);
    await assert.rejects(
      () =>
        updateCityRecord(db, otherTenantId, cityId, {
          name: 'Rome',
          countryId: otherCountryId,
          setAsDefault: true
        }),
      /City not found/
    );
    await assert.rejects(() => deleteRestaurantTypeRecord(db, otherTenantId, typeId), /Restaurant type not found/);

    const stillExists = await db.query.countries.findFirst({
      where: eq(countries.id, countryId)
    });
    assert.equal(stillExists?.tenantId, tenantId);
  } finally {
    await cleanup();
  }
});

dbTest('createRestaurantRecord rejects city and type ids from another tenant', async () => {
  const { db, cleanup, tenantId } = await createTenantFixture();
  const otherTenantId = randomUUID();
  const otherCountryId = randomUUID();
  const otherCityId = randomUUID();
  const otherTypeId = randomUUID();

  try {
    await db.insert(tenants).values({ id: otherTenantId, displayName: 'Other', isRoot: false });
    await db.insert(countries).values({ id: otherCountryId, tenantId: otherTenantId, name: 'Italy' });
    await db.insert(cities).values({
      id: otherCityId,
      tenantId: otherTenantId,
      countryId: otherCountryId,
      name: 'Rome',
      isDefault: true
    });
    await db.insert(restaurantTypes).values({
      id: otherTypeId,
      tenantId: otherTenantId,
      name: 'Pasta',
      emoji: '🍝'
    });

    await assert.rejects(
      () =>
        createRestaurantRecord(
          db,
          tenantId,
          buildRestaurantInput({
            cityId: otherCityId,
            typeIds: [otherTypeId]
          })
        ),
      /City not found/
    );

    const { cityId } = await createTenantFixture();
    void cityId;
  } finally {
    await cleanup();
  }
});

dbTest('createRestaurantRecord rejects type ids outside the current tenant even when city is valid', async () => {
  const { db, cleanup, tenantId, cityId } = await createTenantFixture();
  const otherTenantId = randomUUID();
  const otherCountryId = randomUUID();
  const otherTypeId = randomUUID();

  try {
    await db.insert(tenants).values({ id: otherTenantId, displayName: 'Other', isRoot: false });
    await db.insert(countries).values({ id: otherCountryId, tenantId: otherTenantId, name: 'Italy' });
    await db.insert(restaurantTypes).values({
      id: otherTypeId,
      tenantId: otherTenantId,
      name: 'Pasta',
      emoji: '🍝'
    });

    await assert.rejects(
      () =>
        createRestaurantRecord(
          db,
          tenantId,
          buildRestaurantInput({
            cityId,
            typeIds: [otherTypeId]
          })
        ),
      /invalid/
    );
  } finally {
    await cleanup();
  }
});

dbTest('not-found errors are returned for stale restaurant ids during update, delete, and restore', async () => {
  const { db, cleanup, tenantId, cityId, typeId } = await createTenantFixture();
  const missingRestaurantId = randomUUID();

  try {
    await assert.rejects(
      () =>
        updateRestaurantRecord(
          db,
          tenantId,
          missingRestaurantId,
          buildRestaurantInput({
            cityId,
            typeIds: [typeId]
          })
        ),
      /Restaurant not found/
    );
    await assert.rejects(() => softDeleteRestaurantRecord(db, tenantId, missingRestaurantId), /Restaurant not found/);
    await assert.rejects(() => restoreRestaurantRecord(db, tenantId, missingRestaurantId), /Deleted restaurant not found/);
  } finally {
    await cleanup();
  }
});
