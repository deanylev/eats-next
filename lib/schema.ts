import {
  boolean,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid
} from 'drizzle-orm/pg-core';

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

export const countries = pgTable('countries', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
});

export const cities = pgTable(
  'cities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    countryId: uuid('country_id')
      .references(() => countries.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
  },
  (table) => ({
    countryNameUnique: unique().on(table.countryId, table.name)
  })
);

export const restaurantTypes = pgTable('restaurant_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
});

export const restaurants = pgTable('restaurants', {
  id: uuid('id').defaultRandom().primaryKey(),
  cityId: uuid('city_id')
    .references(() => cities.id, { onDelete: 'restrict' })
    .notNull(),
  name: text('name').notNull(),
  notes: text('notes').notNull(),
  referredBy: text('referred_by').notNull(),
  url: text('url').notNull(),
  status: restaurantStatusEnum('status').notNull(),
  triedAt: timestamp('tried_at', { withTimezone: true }),
  dislikedReason: text('disliked_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
});

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
