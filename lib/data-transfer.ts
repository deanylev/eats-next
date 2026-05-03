import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import {
  cities,
  countries,
  mealTypeEnum,
  restaurantAreas,
  restaurantMeals,
  restaurants,
  restaurantStatusEnum,
  restaurantToTypes,
  restaurantTypes,
  tenants
} from '@/lib/schema';
import type { ResolvedTenant } from '@/lib/tenant';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbLike = Db | Tx;

export const IMPORT_EXPORT_FORMAT = 'eats-next-export' as const;
export const IMPORT_EXPORT_VERSION = 1 as const;

type ExportTenantRecord = {
  adminPasswordHash: string | null;
  adminUsername: string | null;
  createdAt: string;
  displayName: string;
  isRoot: boolean;
  primaryColor: string;
  secondaryColor: string;
  subdomain: string | null;
  updatedAt: string;
};

type ExportCityRecord = {
  countryKey: string;
  createdAt: string;
  exportKey: string;
  isDefault: boolean;
  name: string;
  updatedAt: string;
};

type ExportRestaurantTypeRecord = {
  createdAt: string;
  emoji: string;
  exportKey: string;
  name: string;
  updatedAt: string;
};

type ExportRestaurantRecord = {
  areas: Array<{
    area: string;
    createdAt: string;
    updatedAt: string;
  }>;
  cityKey: string;
  createdAt: string;
  deletedAt: string | null;
  dislikedReason: string | null;
  googlePlaceId?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  mealTypes: Array<{
    createdAt: string;
    mealType: (typeof mealTypeEnum.enumValues)[number];
    updatedAt: string;
  }>;
  name: string;
  notes: string;
  referredBy: string;
  status: (typeof restaurantStatusEnum.enumValues)[number];
  triedAt: string | null;
  typeNames: Array<{
    createdAt: string;
    typeKey: string;
    updatedAt: string;
  }>;
  updatedAt: string;
  url: string;
};

type TenantBundle = {
  cities: ExportCityRecord[];
  countries: Array<{
    createdAt: string;
    exportKey: string;
    name: string;
    updatedAt: string;
  }>;
  restaurants: ExportRestaurantRecord[];
  restaurantTypes: ExportRestaurantTypeRecord[];
  tenant: ExportTenantRecord;
};

type SingleTenantExport = {
  exportedAt: string;
  format: typeof IMPORT_EXPORT_FORMAT;
  scope: 'single-tenant';
  tenant: TenantBundle;
  version: typeof IMPORT_EXPORT_VERSION;
};

type AllTenantsExport = {
  exportedAt: string;
  format: typeof IMPORT_EXPORT_FORMAT;
  rootTenant: TenantBundle;
  scope: 'all-tenants';
  tenants: TenantBundle[];
  version: typeof IMPORT_EXPORT_VERSION;
};

export type ImportExportPayload = SingleTenantExport | AllTenantsExport;

const timestampSchema = z.string().min(1);
const nullableTimestampSchema = timestampSchema.nullable();
const mealTypeSchema = z.enum(mealTypeEnum.enumValues);
const restaurantStatusSchema = z.enum(restaurantStatusEnum.enumValues);

const exportTenantRecordSchema = z.object({
  adminPasswordHash: z.string().nullable(),
  adminUsername: z.string().nullable(),
  createdAt: timestampSchema,
  displayName: z.string().min(1),
  isRoot: z.boolean(),
  primaryColor: z.string().min(1),
  secondaryColor: z.string().min(1),
  subdomain: z.string().nullable(),
  updatedAt: timestampSchema
});

const tenantBundleSchema = z.object({
  cities: z.array(
    z.object({
      countryKey: z.string().min(1),
      createdAt: timestampSchema,
      exportKey: z.string().min(1),
      isDefault: z.boolean(),
      name: z.string().min(1),
      updatedAt: timestampSchema
    })
  ),
  countries: z.array(
    z.object({
      createdAt: timestampSchema,
      exportKey: z.string().min(1),
      name: z.string().min(1),
      updatedAt: timestampSchema
    })
  ),
  restaurants: z.array(
    z.object({
      areas: z.array(
        z.object({
          area: z.string(),
          createdAt: timestampSchema,
          updatedAt: timestampSchema
        })
      ),
      cityKey: z.string().min(1),
      createdAt: timestampSchema,
      deletedAt: nullableTimestampSchema,
      dislikedReason: z.string().nullable(),
      googlePlaceId: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      mealTypes: z.array(
        z.object({
          createdAt: timestampSchema,
          mealType: mealTypeSchema,
          updatedAt: timestampSchema
        })
      ),
      name: z.string().min(1),
      notes: z.string(),
      referredBy: z.string(),
      status: restaurantStatusSchema,
      triedAt: nullableTimestampSchema,
      typeNames: z.array(
        z.object({
          createdAt: timestampSchema,
          typeKey: z.string().min(1),
          updatedAt: timestampSchema
        })
      ),
      updatedAt: timestampSchema,
      url: z.string().min(1)
    })
  ),
  restaurantTypes: z.array(
    z.object({
      createdAt: timestampSchema,
      emoji: z.string().min(1),
      exportKey: z.string().min(1),
      name: z.string().min(1),
      updatedAt: timestampSchema
    })
  ),
  tenant: exportTenantRecordSchema
});

const singleTenantExportSchema = z.object({
  exportedAt: timestampSchema,
  format: z.literal(IMPORT_EXPORT_FORMAT),
  scope: z.literal('single-tenant'),
  tenant: tenantBundleSchema,
  version: z.literal(IMPORT_EXPORT_VERSION)
});

const allTenantsExportSchema = z.object({
  exportedAt: timestampSchema,
  format: z.literal(IMPORT_EXPORT_FORMAT),
  rootTenant: tenantBundleSchema,
  scope: z.literal('all-tenants'),
  tenants: z.array(tenantBundleSchema),
  version: z.literal(IMPORT_EXPORT_VERSION)
});

const importExportPayloadSchema = z.discriminatedUnion('scope', [singleTenantExportSchema, allTenantsExportSchema]);

const toIsoString = (value: Date | null): string | null => (value ? value.toISOString() : null);
const toDate = (value: string | null): Date | null => (value ? new Date(value) : null);
const getTenantRecord = async (db: DbLike, tenantId: string): Promise<ExportTenantRecord> => {
  const tenantRecord = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId)
  });

  if (!tenantRecord) {
    throw new Error('Tenant not found.');
  }

  return {
    adminPasswordHash: tenantRecord.adminPasswordHash,
    adminUsername: tenantRecord.adminUsername,
    createdAt: tenantRecord.createdAt.toISOString(),
    displayName: tenantRecord.displayName,
    isRoot: tenantRecord.isRoot,
    primaryColor: tenantRecord.primaryColor,
    secondaryColor: tenantRecord.secondaryColor,
    subdomain: tenantRecord.subdomain,
    updatedAt: tenantRecord.updatedAt.toISOString()
  };
};

const exportTenantBundle = async (db: DbLike, tenantId: string): Promise<TenantBundle> => {
  const [tenantRecord, countryRows, cityRows, typeRows, restaurantRows, areaRows, mealRows, joinRows] =
    await Promise.all([
      getTenantRecord(db, tenantId),
      db.select().from(countries).where(eq(countries.tenantId, tenantId)).orderBy(asc(countries.name)),
      db
        .select({
          countryName: countries.name,
          createdAt: cities.createdAt,
          isDefault: cities.isDefault,
          name: cities.name,
          updatedAt: cities.updatedAt
        })
        .from(cities)
        .innerJoin(countries, eq(cities.countryId, countries.id))
        .where(eq(cities.tenantId, tenantId))
        .orderBy(asc(countries.name), asc(cities.name)),
      db.select().from(restaurantTypes).where(eq(restaurantTypes.tenantId, tenantId)).orderBy(asc(restaurantTypes.name)),
      db
        .select({
          cityName: cities.name,
          countryName: countries.name,
          createdAt: restaurants.createdAt,
          deletedAt: restaurants.deletedAt,
          dislikedReason: restaurants.dislikedReason,
          id: restaurants.id,
          name: restaurants.name,
          notes: restaurants.notes,
          referredBy: restaurants.referredBy,
          googlePlaceId: restaurants.googlePlaceId,
          address: restaurants.address,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
          status: restaurants.status,
          triedAt: restaurants.triedAt,
          updatedAt: restaurants.updatedAt,
          url: restaurants.url
        })
        .from(restaurants)
        .innerJoin(cities, eq(restaurants.cityId, cities.id))
        .innerJoin(countries, eq(cities.countryId, countries.id))
        .where(eq(restaurants.tenantId, tenantId))
        .orderBy(asc(countries.name), asc(cities.name), asc(restaurants.name)),
      db
        .select()
        .from(restaurantAreas)
        .where(
          sql`exists (
            select 1 from ${restaurants}
            where ${restaurants.id} = ${restaurantAreas.restaurantId}
              and ${restaurants.tenantId} = ${tenantId}
          )`
        ),
      db
        .select()
        .from(restaurantMeals)
        .where(
          sql`exists (
            select 1 from ${restaurants}
            where ${restaurants.id} = ${restaurantMeals.restaurantId}
              and ${restaurants.tenantId} = ${tenantId}
          )`
        ),
      db
        .select({
          createdAt: restaurantToTypes.createdAt,
          restaurantId: restaurantToTypes.restaurantId,
          typeName: restaurantTypes.name,
          updatedAt: restaurantToTypes.updatedAt
        })
        .from(restaurantToTypes)
        .innerJoin(restaurantTypes, eq(restaurantToTypes.restaurantTypeId, restaurantTypes.id))
        .where(eq(restaurantTypes.tenantId, tenantId))
    ]);

  const areasByRestaurant = new Map<string, ExportRestaurantRecord['areas']>();
  for (const area of areaRows) {
    const existing = areasByRestaurant.get(area.restaurantId) ?? [];
    existing.push({
      area: area.area,
      createdAt: area.createdAt.toISOString(),
      updatedAt: area.updatedAt.toISOString()
    });
    areasByRestaurant.set(area.restaurantId, existing);
  }

  const mealsByRestaurant = new Map<string, ExportRestaurantRecord['mealTypes']>();
  for (const meal of mealRows) {
    const existing = mealsByRestaurant.get(meal.restaurantId) ?? [];
    existing.push({
      createdAt: meal.createdAt.toISOString(),
      mealType: meal.mealType,
      updatedAt: meal.updatedAt.toISOString()
    });
    mealsByRestaurant.set(meal.restaurantId, existing);
  }

  const countryKeyByName = new Map<string, string>();
  const exportedCountries = countryRows.map((country, index) => {
    const exportKey = `country_${index + 1}`;
    countryKeyByName.set(country.name, exportKey);

    return {
      createdAt: country.createdAt.toISOString(),
      exportKey,
      name: country.name,
      updatedAt: country.updatedAt.toISOString()
    };
  });

  const cityKeyByComposite = new Map<string, string>();
  const exportedCities = cityRows.map((city, index) => {
    const exportKey = `city_${index + 1}`;
    const countryKey = countryKeyByName.get(city.countryName);
    if (!countryKey) {
      throw new Error(`Country "${city.countryName}" not found while exporting city "${city.name}".`);
    }

    cityKeyByComposite.set(`${city.countryName}:::${city.name}`, exportKey);

    return {
      countryKey,
      createdAt: city.createdAt.toISOString(),
      exportKey,
      isDefault: city.isDefault,
      name: city.name,
      updatedAt: city.updatedAt.toISOString()
    };
  });

  const typeKeyByName = new Map<string, string>();
  const exportedTypes = typeRows.map((type, index) => {
    const exportKey = `type_${index + 1}`;
    typeKeyByName.set(type.name, exportKey);

    return {
      createdAt: type.createdAt.toISOString(),
      emoji: type.emoji,
      exportKey,
      name: type.name,
      updatedAt: type.updatedAt.toISOString()
    };
  });

  const typeNamesByRestaurant = new Map<string, ExportRestaurantRecord['typeNames']>();
  for (const join of joinRows) {
    const typeKey = typeKeyByName.get(join.typeName);
    if (!typeKey) {
      throw new Error(`Restaurant type "${join.typeName}" not found while exporting restaurant type joins.`);
    }

    const existing = typeNamesByRestaurant.get(join.restaurantId) ?? [];
    existing.push({
      createdAt: join.createdAt.toISOString(),
      typeKey,
      updatedAt: join.updatedAt.toISOString()
    });
    typeNamesByRestaurant.set(join.restaurantId, existing);
  }

  return {
    cities: exportedCities,
    countries: exportedCountries,
    restaurants: restaurantRows.map((restaurant) => ({
      areas: areasByRestaurant.get(restaurant.id) ?? [],
      cityKey:
        cityKeyByComposite.get(`${restaurant.countryName}:::${restaurant.cityName}`) ??
        (() => {
          throw new Error(
            `City "${restaurant.cityName}, ${restaurant.countryName}" not found while exporting restaurant "${restaurant.name}".`
          );
        })(),
      createdAt: restaurant.createdAt.toISOString(),
      deletedAt: toIsoString(restaurant.deletedAt),
      dislikedReason: restaurant.dislikedReason,
      googlePlaceId: restaurant.googlePlaceId,
      address: restaurant.address,
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
      mealTypes: mealsByRestaurant.get(restaurant.id) ?? [],
      name: restaurant.name,
      notes: restaurant.notes,
      referredBy: restaurant.referredBy,
      status: restaurant.status,
      triedAt: toIsoString(restaurant.triedAt),
      typeNames: typeNamesByRestaurant.get(restaurant.id) ?? [],
      updatedAt: restaurant.updatedAt.toISOString(),
      url: restaurant.url
    })),
    restaurantTypes: exportedTypes,
    tenant: tenantRecord
  };
};

export const buildSingleTenantExport = async (db: Db, tenantId: string): Promise<SingleTenantExport> => ({
  exportedAt: new Date().toISOString(),
  format: IMPORT_EXPORT_FORMAT,
  scope: 'single-tenant',
  tenant: await exportTenantBundle(db, tenantId),
  version: IMPORT_EXPORT_VERSION
});

export const buildAllTenantsExport = async (db: Db, rootTenantId: string): Promise<AllTenantsExport> => {
  const subtenantRows = await db.query.tenants.findMany({
    where: eq(tenants.isRoot, false),
    orderBy: (table, { asc: orderAsc }) => [orderAsc(table.subdomain)]
  });

  return {
    exportedAt: new Date().toISOString(),
    format: IMPORT_EXPORT_FORMAT,
    rootTenant: await exportTenantBundle(db, rootTenantId),
    scope: 'all-tenants',
    tenants: await Promise.all(subtenantRows.map((tenant) => exportTenantBundle(db, tenant.id))),
    version: IMPORT_EXPORT_VERSION
  };
};

const clearTenantData = async (tx: DbLike, tenantId: string): Promise<void> => {
  await tx.delete(restaurantToTypes).where(
    sql`${restaurantToTypes.restaurantId} in (${tx.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.tenantId, tenantId))})`
  );
  await tx.delete(restaurantMeals).where(
    sql`${restaurantMeals.restaurantId} in (${tx.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.tenantId, tenantId))})`
  );
  await tx.delete(restaurantAreas).where(
    sql`${restaurantAreas.restaurantId} in (${tx.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.tenantId, tenantId))})`
  );
  await tx.delete(restaurants).where(eq(restaurants.tenantId, tenantId));
  await tx.delete(cities).where(eq(cities.tenantId, tenantId));
  await tx.delete(countries).where(eq(countries.tenantId, tenantId));
  await tx.delete(restaurantTypes).where(eq(restaurantTypes.tenantId, tenantId));
};

const insertTenantBundleData = async (tx: DbLike, tenantId: string, bundle: TenantBundle): Promise<void> => {
  const countryIdsByKey = new Map<string, string>();
  for (const country of bundle.countries) {
    const countryId = randomUUID();
    countryIdsByKey.set(country.exportKey, countryId);
    await tx.insert(countries).values({
      createdAt: toDate(country.createdAt) ?? new Date(),
      id: countryId,
      name: country.name,
      tenantId,
      updatedAt: toDate(country.updatedAt) ?? new Date()
    });
  }

  const cityIdsByKey = new Map<string, string>();
  for (const city of bundle.cities) {
    const countryId = countryIdsByKey.get(city.countryKey);
    if (!countryId) {
      throw new Error(`Country reference "${city.countryKey}" not found while importing city "${city.name}".`);
    }

    const cityId = randomUUID();
    cityIdsByKey.set(city.exportKey, cityId);
    await tx.insert(cities).values({
      countryId,
      createdAt: toDate(city.createdAt) ?? new Date(),
      id: cityId,
      isDefault: city.isDefault,
      name: city.name,
      tenantId,
      updatedAt: toDate(city.updatedAt) ?? new Date()
    });
  }

  const typeIdsByKey = new Map<string, string>();
  for (const type of bundle.restaurantTypes) {
    const typeId = randomUUID();
    typeIdsByKey.set(type.exportKey, typeId);
    await tx.insert(restaurantTypes).values({
      createdAt: toDate(type.createdAt) ?? new Date(),
      emoji: type.emoji,
      id: typeId,
      name: type.name,
      tenantId,
      updatedAt: toDate(type.updatedAt) ?? new Date()
    });
  }

  for (const restaurant of bundle.restaurants) {
    const cityId = cityIdsByKey.get(restaurant.cityKey);
    if (!cityId) {
      throw new Error(`City reference "${restaurant.cityKey}" not found while importing restaurant "${restaurant.name}".`);
    }

    const restaurantId = randomUUID();
    await tx.insert(restaurants).values({
      cityId,
      createdAt: toDate(restaurant.createdAt) ?? new Date(),
      deletedAt: toDate(restaurant.deletedAt),
      dislikedReason: restaurant.dislikedReason,
      googlePlaceId: restaurant.googlePlaceId ?? null,
      address: restaurant.address ?? null,
      latitude: restaurant.latitude ?? null,
      longitude: restaurant.longitude ?? null,
      id: restaurantId,
      name: restaurant.name,
      notes: restaurant.notes,
      referredBy: restaurant.referredBy,
      status: restaurant.status,
      tenantId,
      triedAt: toDate(restaurant.triedAt),
      updatedAt: toDate(restaurant.updatedAt) ?? new Date(),
      url: restaurant.url
    });

    if (restaurant.areas.length > 0) {
      await tx.insert(restaurantAreas).values(
        restaurant.areas.map((area) => ({
          area: area.area,
          createdAt: toDate(area.createdAt) ?? new Date(),
          id: randomUUID(),
          restaurantId,
          updatedAt: toDate(area.updatedAt) ?? new Date()
        }))
      );
    }

    if (restaurant.mealTypes.length > 0) {
      await tx.insert(restaurantMeals).values(
        restaurant.mealTypes.map((meal) => ({
          createdAt: toDate(meal.createdAt) ?? new Date(),
          mealType: meal.mealType,
          restaurantId,
          updatedAt: toDate(meal.updatedAt) ?? new Date()
        }))
      );
    }

    if (restaurant.typeNames.length > 0) {
      await tx.insert(restaurantToTypes).values(
        restaurant.typeNames.map((typeRef) => {
          const restaurantTypeId = typeIdsByKey.get(typeRef.typeKey);
          if (!restaurantTypeId) {
            throw new Error(`Restaurant type reference "${typeRef.typeKey}" not found while importing restaurant "${restaurant.name}".`);
          }

          return {
            createdAt: toDate(typeRef.createdAt) ?? new Date(),
            restaurantId,
            restaurantTypeId,
            updatedAt: toDate(typeRef.updatedAt) ?? new Date()
          };
        })
      );
    }
  }
};

const validateSubtenantBundle = (bundle: TenantBundle): void => {
  if (bundle.tenant.isRoot) {
    throw new Error('Subtenant bundle cannot be marked as root.');
  }

  if (!bundle.tenant.subdomain) {
    throw new Error('Subtenant bundle must include a subdomain.');
  }
};

const validateRootTenantBundle = (bundle: TenantBundle): void => {
  if (!bundle.tenant.isRoot) {
    throw new Error('Root tenant bundle must be marked as root.');
  }

  if (bundle.tenant.subdomain !== null) {
    throw new Error('Root tenant bundle cannot include a subdomain.');
  }
};

export const parseImportExportPayload = (raw: string): ImportExportPayload => {
  const parsed = JSON.parse(raw);
  return importExportPayloadSchema.parse(parsed);
};

export const importIntoCurrentTenant = async (
  db: Db,
  currentTenant: ResolvedTenant,
  payload: SingleTenantExport
): Promise<void> => {
  await db.transaction(async (tx) => {
    await clearTenantData(tx, currentTenant.id);

    const nextTenantState = {
      createdAt: toDate(payload.tenant.tenant.createdAt) ?? new Date(),
      displayName: payload.tenant.tenant.displayName,
      primaryColor: payload.tenant.tenant.primaryColor,
      secondaryColor: payload.tenant.tenant.secondaryColor,
      updatedAt: toDate(payload.tenant.tenant.updatedAt) ?? new Date()
    } as const;

    if (currentTenant.isRoot) {
      await tx.update(tenants).set(nextTenantState).where(eq(tenants.id, currentTenant.id));
    } else {
      await tx
        .update(tenants)
        .set({
          ...nextTenantState,
          adminPasswordHash: payload.tenant.tenant.adminPasswordHash,
          adminUsername: payload.tenant.tenant.adminUsername
        })
        .where(eq(tenants.id, currentTenant.id));
    }

    await insertTenantBundleData(tx, currentTenant.id, payload.tenant);
  });
};

export const importAllTenants = async (db: Db, currentRootTenant: ResolvedTenant, payload: AllTenantsExport): Promise<void> => {
  if (!currentRootTenant.isRoot) {
    throw new Error('Only the root tenant can import an all-tenants export.');
  }

  validateRootTenantBundle(payload.rootTenant);
  for (const bundle of payload.tenants) {
    validateSubtenantBundle(bundle);
  }

  await db.transaction(async (tx) => {
    const existingSubtenants = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.isRoot, false));

    for (const subtenant of existingSubtenants) {
      await clearTenantData(tx, subtenant.id);
    }

    await tx.delete(tenants).where(eq(tenants.isRoot, false));
    await clearTenantData(tx, currentRootTenant.id);

    await tx
      .update(tenants)
      .set({
        createdAt: toDate(payload.rootTenant.tenant.createdAt) ?? new Date(),
        displayName: payload.rootTenant.tenant.displayName,
        primaryColor: payload.rootTenant.tenant.primaryColor,
        secondaryColor: payload.rootTenant.tenant.secondaryColor,
        updatedAt: toDate(payload.rootTenant.tenant.updatedAt) ?? new Date()
      })
      .where(eq(tenants.id, currentRootTenant.id));

    await insertTenantBundleData(tx, currentRootTenant.id, payload.rootTenant);

    for (const bundle of payload.tenants) {
      const tenantId = randomUUID();
      await tx.insert(tenants).values({
        adminPasswordHash: bundle.tenant.adminPasswordHash,
        adminUsername: bundle.tenant.adminUsername,
        createdAt: toDate(bundle.tenant.createdAt) ?? new Date(),
        displayName: bundle.tenant.displayName,
        id: tenantId,
        isRoot: false,
        primaryColor: bundle.tenant.primaryColor,
        secondaryColor: bundle.tenant.secondaryColor,
        subdomain: bundle.tenant.subdomain,
        updatedAt: toDate(bundle.tenant.updatedAt) ?? new Date()
      });

      await insertTenantBundleData(tx, tenantId, bundle);
    }
  });
};
