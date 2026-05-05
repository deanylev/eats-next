import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  foreignKey,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@/lib/theme';

export const mealTypeEnum = pgEnum('meal_type', [
  'snack',
  'breakfast',
  'lunch',
  'dinner'
]);

export const restaurantStatusEnum = pgEnum('restaurant_status', [
  'untried',
  'liked',
  'disliked'
]);

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  subdomain: text('subdomain').unique(),
  displayName: text('display_name').notNull(),
  primaryColor: text('primary_color').default(DEFAULT_PRIMARY_COLOR).notNull(),
  secondaryColor: text('secondary_color').default(DEFAULT_SECONDARY_COLOR).notNull(),
  adminUsername: text('admin_username'),
  adminPasswordHash: text('admin_password_hash'),
  isRoot: boolean('is_root').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
});

export const countries = pgTable(
  'countries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
  },
  (table) => ({
    tenantNameUnique: unique().on(table.tenantId, table.name),
    tenantIdIdUnique: unique().on(table.tenantId, table.id)
  })
);

export const cities = pgTable(
  'cities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    countryId: uuid('country_id').notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
  },
  (table) => ({
    countryNameUnique: unique().on(table.tenantId, table.countryId, table.name),
    tenantIdIdUnique: unique().on(table.tenantId, table.id),
    tenantCountryFk: foreignKey({
      columns: [table.tenantId, table.countryId],
      foreignColumns: [countries.tenantId, countries.id],
      name: 'cities_tenant_country_fk'
    }).onDelete('cascade'),
    singleDefaultPerTenant: uniqueIndex('cities_single_default_per_tenant_idx')
      .on(table.tenantId)
      .where(sql`${table.isDefault} = true`)
  })
);

export const restaurantTypes = pgTable(
  'restaurant_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
  },
  (table) => ({
    tenantTypeNameUnique: unique().on(table.tenantId, table.name),
    tenantIdIdUnique: unique().on(table.tenantId, table.id)
  })
);

export const restaurants = pgTable(
  'restaurants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    cityId: uuid('city_id').notNull(),
    name: text('name').notNull(),
    notes: text('notes').notNull(),
    referredBy: text('referred_by').notNull(),
    url: text('url').notNull(),
    googlePlaceId: text('google_place_id'),
    address: text('address'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    status: restaurantStatusEnum('status').notNull(),
    triedAt: timestamp('tried_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    dislikedReason: text('disliked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
  },
  (table) => ({
    tenantIdIdUnique: unique().on(table.tenantId, table.id),
    tenantCityFk: foreignKey({
      columns: [table.tenantId, table.cityId],
      foreignColumns: [cities.tenantId, cities.id],
      name: 'restaurants_tenant_city_fk'
    }).onDelete('restrict')
  })
);

export const restaurantLocations = pgTable(
  'restaurant_locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    restaurantId: uuid('restaurant_id').notNull(),
    label: text('label'),
    address: text('address'),
    googlePlaceId: text('google_place_id'),
    googleMapsUrl: text('google_maps_url'),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
  },
  (table) => ({
    tenantRestaurantFk: foreignKey({
      columns: [table.tenantId, table.restaurantId],
      foreignColumns: [restaurants.tenantId, restaurants.id],
      name: 'restaurant_locations_tenant_restaurant_fk'
    }).onDelete('cascade'),
    tenantPlaceUnique: unique().on(table.tenantId, table.restaurantId, table.googlePlaceId),
    tenantRestaurantIdUnique: unique().on(table.tenantId, table.restaurantId, table.id)
  })
);

export const restaurantAreas = pgTable('restaurant_areas', {
  id: uuid('id').defaultRandom().primaryKey(),
  restaurantId: uuid('restaurant_id')
    .references(() => restaurants.id, { onDelete: 'cascade' })
    .notNull(),
  area: text('area').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
});

export const restaurantMeals = pgTable(
  'restaurant_meals',
  {
    restaurantId: uuid('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    mealType: mealTypeEnum('meal_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.restaurantId, table.mealType] })
  })
);

export const restaurantToTypes = pgTable(
  'restaurant_to_types',
  {
    restaurantId: uuid('restaurant_id')
      .references(() => restaurants.id, { onDelete: 'cascade' })
      .notNull(),
    restaurantTypeId: uuid('restaurant_type_id')
      .references(() => restaurantTypes.id, { onDelete: 'restrict' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.restaurantId, table.restaurantTypeId] })
  })
);

export type MealType = (typeof mealTypeEnum.enumValues)[number];
export type RestaurantStatus = (typeof restaurantStatusEnum.enumValues)[number];
