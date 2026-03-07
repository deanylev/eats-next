import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  buildAllTenantsExport,
  buildSingleTenantExport,
  IMPORT_EXPORT_VERSION,
  importAllTenants,
  importIntoCurrentTenant,
  parseImportExportPayload
} from '../lib/data-transfer';
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
import type { ResolvedTenant } from '../lib/tenant';
import { createTestDb, hasTestDatabase } from './helpers/test-db';

const dbTest = hasTestDatabase ? test : test.skip;

const createTenant = async (
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  overrides?: Partial<{ id: string; displayName: string; isRoot: boolean; subdomain: string | null }>
) => {
  if (overrides?.isRoot) {
    const existingRoot = await db.query.tenants.findFirst({
      where: eq(tenants.isRoot, true)
    });

    if (!existingRoot) {
      throw new Error('Expected root tenant to exist in test database.');
    }

    await db
      .update(tenants)
      .set({
        displayName: overrides.displayName ?? existingRoot.displayName,
        primaryColor: existingRoot.primaryColor,
        secondaryColor: existingRoot.secondaryColor
      })
      .where(eq(tenants.id, existingRoot.id));

    return existingRoot.id;
  }

  const tenantId = overrides?.id ?? randomUUID();
  await db.insert(tenants).values({
    id: tenantId,
    adminPasswordHash: overrides?.isRoot ? null : 'hash',
    adminUsername: overrides?.isRoot ? null : 'user',
    displayName: overrides?.displayName ?? 'Dean',
    isRoot: overrides?.isRoot ?? false,
    subdomain: overrides?.subdomain ?? null
  });

  return tenantId;
};

const seedTenantData = async (
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  tenantId: string,
  options?: {
    cityName?: string;
    countryName?: string;
    restaurantName?: string;
    restaurantTypeName?: string;
  }
) => {
  const countryId = randomUUID();
  const cityId = randomUUID();
  const typeId = randomUUID();
  const restaurantId = randomUUID();
  const countryName = options?.countryName ?? 'Australia';
  const cityName = options?.cityName ?? 'Melbourne';
  const restaurantName = options?.restaurantName ?? 'Kelso';
  const restaurantTypeName = options?.restaurantTypeName ?? 'Sandwiches';

  await db.insert(countries).values({ id: countryId, tenantId, name: countryName });
  await db.insert(cities).values({ id: cityId, tenantId, countryId, isDefault: true, name: cityName });
  await db.insert(restaurantTypes).values({ id: typeId, tenantId, name: restaurantTypeName, emoji: '🥪' });
  await db.insert(restaurants).values({
    id: restaurantId,
    cityId,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    deletedAt: null,
    dislikedReason: null,
    name: restaurantName,
    notes: 'Great sandwich',
    referredBy: 'Friend',
    status: 'liked',
    tenantId,
    triedAt: new Date('2024-02-01T00:00:00.000Z'),
    updatedAt: new Date('2024-03-01T00:00:00.000Z'),
    url: 'https://example.com/'
  });
  await db.insert(restaurantAreas).values({ id: randomUUID(), restaurantId, area: 'CBD' });
  await db.insert(restaurantMeals).values({ restaurantId, mealType: 'lunch' });
  await db.insert(restaurantToTypes).values({ restaurantId, restaurantTypeId: typeId });

  return {
    cityId,
    countryId,
    restaurantId,
    typeId
  };
};

const getTenantContext = (tenantId: string, options?: Partial<ResolvedTenant>): ResolvedTenant => ({
  id: tenantId,
  displayName: options?.displayName ?? 'Dean',
  isRoot: options?.isRoot ?? false,
  primaryColor: options?.primaryColor ?? '#1b0426',
  secondaryColor: options?.secondaryColor ?? '#e8a61a',
  subdomain: options?.subdomain ?? null
});

dbTest('buildSingleTenantExport omits database ids from records and uses export keys', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = await createTenant(db, { displayName: 'Dean', isRoot: false, subdomain: 'eats-dean' });

  try {
    await seedTenantData(db, tenantId);

    const payload = await buildSingleTenantExport(db, tenantId);

    assert.equal(payload.scope, 'single-tenant');
    assert.equal(payload.version, IMPORT_EXPORT_VERSION);
    assert.equal('id' in payload.tenant.countries[0]!, false);
    assert.equal('id' in payload.tenant.cities[0]!, false);
    assert.equal('id' in payload.tenant.restaurantTypes[0]!, false);
    assert.equal('id' in payload.tenant.restaurants[0]!, false);
    assert.match(payload.tenant.countries[0]?.exportKey ?? '', /^country_/);
    assert.match(payload.tenant.cities[0]?.exportKey ?? '', /^city_/);
    assert.match(payload.tenant.restaurantTypes[0]?.exportKey ?? '', /^type_/);
    assert.equal(payload.tenant.restaurants[0]?.cityKey, payload.tenant.cities[0]?.exportKey);
    assert.equal(payload.tenant.restaurants[0]?.typeNames[0]?.typeKey, payload.tenant.restaurantTypes[0]?.exportKey);
  } finally {
    await cleanup();
  }
});

dbTest('parseImportExportPayload accepts v1 single-tenant exports', async () => {
  const { db, cleanup } = await createTestDb();
  const tenantId = await createTenant(db, { displayName: 'Dean', isRoot: false, subdomain: 'eats-dean' });

  try {
    await seedTenantData(db, tenantId);
    const payload = await buildSingleTenantExport(db, tenantId);

    const parsed = parseImportExportPayload(JSON.stringify(payload));
    assert.equal(parsed.scope, 'single-tenant');
    assert.equal(parsed.version, IMPORT_EXPORT_VERSION);
  } finally {
    await cleanup();
  }
});

dbTest('importIntoCurrentTenant regenerates record ids while preserving tenant row', async () => {
  const { db, cleanup } = await createTestDb();
  const sourceTenantId = await createTenant(db, { displayName: 'Source', isRoot: false, subdomain: 'eats-source' });
  const targetTenantId = await createTenant(db, { displayName: 'Target', isRoot: false, subdomain: 'eats-target' });

  try {
    const sourceIds = await seedTenantData(db, sourceTenantId, {
      cityName: 'Sydney',
      countryName: 'Australia',
      restaurantName: 'Hubert',
      restaurantTypeName: 'French'
    });

    const payload = await buildSingleTenantExport(db, sourceTenantId);

    await importIntoCurrentTenant(db, getTenantContext(targetTenantId, { displayName: 'Target', subdomain: 'eats-target' }), payload);

    const importedCountry = await db.query.countries.findFirst({
      where: eq(countries.tenantId, targetTenantId)
    });
    const importedCity = await db.query.cities.findFirst({
      where: eq(cities.tenantId, targetTenantId)
    });
    const importedType = await db.query.restaurantTypes.findFirst({
      where: eq(restaurantTypes.tenantId, targetTenantId)
    });
    const importedRestaurant = await db.query.restaurants.findFirst({
      where: eq(restaurants.tenantId, targetTenantId)
    });

    assert.ok(importedCountry);
    assert.ok(importedCity);
    assert.ok(importedType);
    assert.ok(importedRestaurant);
    assert.notEqual(importedCountry?.id, sourceIds.countryId);
    assert.notEqual(importedCity?.id, sourceIds.cityId);
    assert.notEqual(importedType?.id, sourceIds.typeId);
    assert.notEqual(importedRestaurant?.id, sourceIds.restaurantId);
    assert.equal(importedRestaurant?.name, 'Hubert');

    const targetTenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, targetTenantId)
    });
    assert.equal(targetTenant?.id, targetTenantId);
    assert.equal(targetTenant?.displayName, 'Source');
    assert.equal(targetTenant?.subdomain, 'eats-target');
  } finally {
    await cleanup();
  }
});

dbTest('buildAllTenantsExport and importAllTenants round-trip tenant datasets with fresh subtenant ids', async () => {
  const { db, cleanup } = await createTestDb();
  const rootTenantId = await createTenant(db, { displayName: 'Root', id: randomUUID(), isRoot: true, subdomain: null });
  const subtenantId = await createTenant(db, { displayName: 'Tenant A', subdomain: 'eats-a' });

  try {
    await seedTenantData(db, rootTenantId, {
      cityName: 'Melbourne',
      countryName: 'Australia',
      restaurantName: 'Root Place',
      restaurantTypeName: 'Cafe'
    });
    const subtenantSourceIds = await seedTenantData(db, subtenantId, {
      cityName: 'Tokyo',
      countryName: 'Japan',
      restaurantName: 'Tenant Place',
      restaurantTypeName: 'Ramen'
    });

    const payload = await buildAllTenantsExport(db, rootTenantId);

    await importAllTenants(db, getTenantContext(rootTenantId, { displayName: 'Root', isRoot: true }), payload);

    const rootRestaurants = await db.select().from(restaurants).where(eq(restaurants.tenantId, rootTenantId));
    assert.equal(rootRestaurants.length, 1);
    assert.equal(rootRestaurants[0]?.name, 'Root Place');

    const importedSubtenants = await db.select().from(tenants).where(eq(tenants.isRoot, false));
    assert.equal(importedSubtenants.length, 1);
    assert.equal(importedSubtenants[0]?.displayName, 'Tenant A');
    assert.notEqual(importedSubtenants[0]?.id, subtenantId);

    const importedSubtenantId = importedSubtenants[0]?.id;
    assert.ok(importedSubtenantId);

    const importedSubtenantRestaurants = await db.select().from(restaurants).where(eq(restaurants.tenantId, importedSubtenantId!));
    assert.equal(importedSubtenantRestaurants.length, 1);
    assert.equal(importedSubtenantRestaurants[0]?.name, 'Tenant Place');
    assert.notEqual(importedSubtenantRestaurants[0]?.id, subtenantSourceIds.restaurantId);
  } finally {
    await cleanup();
  }
});
