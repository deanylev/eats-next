import { eq, sql } from 'drizzle-orm';
import type { getDb } from '@/lib/db';
import {
  cities,
  countries,
  restaurantAreas,
  restaurantLocations,
  restaurantMeals,
  restaurants,
  restaurantToTypes,
  restaurantTypes,
  tenants
} from '@/lib/schema';

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbLike = Db | Tx;

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
  await tx.delete(restaurantLocations).where(eq(restaurantLocations.tenantId, tenantId));
  await tx.delete(restaurants).where(eq(restaurants.tenantId, tenantId));
  await tx.delete(cities).where(eq(cities.tenantId, tenantId));
  await tx.delete(countries).where(eq(countries.tenantId, tenantId));
  await tx.delete(restaurantTypes).where(eq(restaurantTypes.tenantId, tenantId));
};

export const deleteSubdomainTenantRecord = async (db: Db, tenantId: string): Promise<void> => {
  await db.transaction(async (tx) => {
    await clearTenantData(tx, tenantId);
    await tx.delete(tenants).where(eq(tenants.id, tenantId));
  });
};
