CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint

ALTER TABLE "countries" ADD COLUMN "id_uuid" uuid;--> statement-breakpoint
UPDATE "countries" SET "id_uuid" = gen_random_uuid() WHERE "id_uuid" IS NULL;--> statement-breakpoint
ALTER TABLE "countries" ALTER COLUMN "id_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "countries" ALTER COLUMN "id_uuid" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

ALTER TABLE "restaurant_types" ADD COLUMN "id_uuid" uuid;--> statement-breakpoint
UPDATE "restaurant_types" SET "id_uuid" = gen_random_uuid() WHERE "id_uuid" IS NULL;--> statement-breakpoint
ALTER TABLE "restaurant_types" ALTER COLUMN "id_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_types" ALTER COLUMN "id_uuid" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "restaurant_types" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

ALTER TABLE "cities" ADD COLUMN "id_uuid" uuid;--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "country_id_uuid" uuid;--> statement-breakpoint
UPDATE "cities" SET "id_uuid" = gen_random_uuid() WHERE "id_uuid" IS NULL;--> statement-breakpoint
UPDATE "cities"
SET "country_id_uuid" = "countries"."id_uuid"
FROM "countries"
WHERE "cities"."country_id" = "countries"."id";--> statement-breakpoint
ALTER TABLE "cities" ALTER COLUMN "id_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cities" ALTER COLUMN "country_id_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cities" ALTER COLUMN "id_uuid" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

ALTER TABLE "restaurants" ADD COLUMN "id_uuid" uuid;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "city_id_uuid" uuid;--> statement-breakpoint
UPDATE "restaurants" SET "id_uuid" = gen_random_uuid() WHERE "id_uuid" IS NULL;--> statement-breakpoint
UPDATE "restaurants"
SET "city_id_uuid" = "cities"."id_uuid"
FROM "cities"
WHERE "restaurants"."city_id" = "cities"."id";--> statement-breakpoint
ALTER TABLE "restaurants" ALTER COLUMN "id_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ALTER COLUMN "city_id_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ALTER COLUMN "id_uuid" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

ALTER TABLE "restaurant_areas" ADD COLUMN "id_uuid" uuid;--> statement-breakpoint
ALTER TABLE "restaurant_areas" ADD COLUMN "restaurant_id_uuid" uuid;--> statement-breakpoint
ALTER TABLE "restaurant_areas" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_areas" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "restaurant_areas" SET "id_uuid" = gen_random_uuid() WHERE "id_uuid" IS NULL;--> statement-breakpoint
UPDATE "restaurant_areas"
SET "restaurant_id_uuid" = "restaurants"."id_uuid"
FROM "restaurants"
WHERE "restaurant_areas"."restaurant_id" = "restaurants"."id";--> statement-breakpoint
ALTER TABLE "restaurant_areas" ALTER COLUMN "id_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_areas" ALTER COLUMN "restaurant_id_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_areas" ALTER COLUMN "id_uuid" SET DEFAULT gen_random_uuid();--> statement-breakpoint

ALTER TABLE "restaurant_meals" ADD COLUMN "restaurant_id_uuid" uuid;--> statement-breakpoint
ALTER TABLE "restaurant_meals" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_meals" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "restaurant_meals"
SET "restaurant_id_uuid" = "restaurants"."id_uuid"
FROM "restaurants"
WHERE "restaurant_meals"."restaurant_id" = "restaurants"."id";--> statement-breakpoint
ALTER TABLE "restaurant_meals" ALTER COLUMN "restaurant_id_uuid" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "restaurant_to_types" ADD COLUMN "restaurant_id_uuid" uuid;--> statement-breakpoint
ALTER TABLE "restaurant_to_types" ADD COLUMN "restaurant_type_id_uuid" uuid;--> statement-breakpoint
ALTER TABLE "restaurant_to_types" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_to_types" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "restaurant_to_types"
SET "restaurant_id_uuid" = "restaurants"."id_uuid"
FROM "restaurants"
WHERE "restaurant_to_types"."restaurant_id" = "restaurants"."id";--> statement-breakpoint
UPDATE "restaurant_to_types"
SET "restaurant_type_id_uuid" = "restaurant_types"."id_uuid"
FROM "restaurant_types"
WHERE "restaurant_to_types"."restaurant_type_id" = "restaurant_types"."id";--> statement-breakpoint
ALTER TABLE "restaurant_to_types" ALTER COLUMN "restaurant_id_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_to_types" ALTER COLUMN "restaurant_type_id_uuid" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "cities" DROP CONSTRAINT IF EXISTS "cities_country_id_countries_id_fk";--> statement-breakpoint
ALTER TABLE "restaurants" DROP CONSTRAINT IF EXISTS "restaurants_city_id_cities_id_fk";--> statement-breakpoint
ALTER TABLE "restaurant_areas" DROP CONSTRAINT IF EXISTS "restaurant_areas_restaurant_id_restaurants_id_fk";--> statement-breakpoint
ALTER TABLE "restaurant_meals" DROP CONSTRAINT IF EXISTS "restaurant_meals_restaurant_id_restaurants_id_fk";--> statement-breakpoint
ALTER TABLE "restaurant_to_types" DROP CONSTRAINT IF EXISTS "restaurant_to_types_restaurant_id_restaurants_id_fk";--> statement-breakpoint
ALTER TABLE "restaurant_to_types" DROP CONSTRAINT IF EXISTS "restaurant_to_types_restaurant_type_id_restaurant_types_id_fk";--> statement-breakpoint
ALTER TABLE "cities" DROP CONSTRAINT IF EXISTS "cities_country_id_name_unique";--> statement-breakpoint

ALTER TABLE "restaurant_meals" DROP CONSTRAINT IF EXISTS "restaurant_meals_restaurant_id_meal_type_pk";--> statement-breakpoint
ALTER TABLE "restaurant_to_types" DROP CONSTRAINT IF EXISTS "restaurant_to_types_restaurant_id_restaurant_type_id_pk";--> statement-breakpoint

ALTER TABLE "restaurant_areas" DROP CONSTRAINT IF EXISTS "restaurant_areas_pkey";--> statement-breakpoint
ALTER TABLE "restaurants" DROP CONSTRAINT IF EXISTS "restaurants_pkey";--> statement-breakpoint
ALTER TABLE "cities" DROP CONSTRAINT IF EXISTS "cities_pkey";--> statement-breakpoint
ALTER TABLE "countries" DROP CONSTRAINT IF EXISTS "countries_pkey";--> statement-breakpoint
ALTER TABLE "restaurant_types" DROP CONSTRAINT IF EXISTS "restaurant_types_pkey";--> statement-breakpoint

ALTER TABLE "countries" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "countries" RENAME COLUMN "id_uuid" TO "id";--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_pkey" PRIMARY KEY ("id");--> statement-breakpoint

ALTER TABLE "restaurant_types" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "restaurant_types" RENAME COLUMN "id_uuid" TO "id";--> statement-breakpoint
ALTER TABLE "restaurant_types" ADD CONSTRAINT "restaurant_types_pkey" PRIMARY KEY ("id");--> statement-breakpoint

ALTER TABLE "cities" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "cities" DROP COLUMN "country_id";--> statement-breakpoint
ALTER TABLE "cities" RENAME COLUMN "id_uuid" TO "id";--> statement-breakpoint
ALTER TABLE "cities" RENAME COLUMN "country_id_uuid" TO "country_id";--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_name_unique" UNIQUE ("country_id", "name");--> statement-breakpoint

ALTER TABLE "restaurants" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "restaurants" DROP COLUMN "city_id";--> statement-breakpoint
ALTER TABLE "restaurants" RENAME COLUMN "id_uuid" TO "id";--> statement-breakpoint
ALTER TABLE "restaurants" RENAME COLUMN "city_id_uuid" TO "city_id";--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");--> statement-breakpoint

ALTER TABLE "restaurant_areas" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "restaurant_areas" DROP COLUMN "restaurant_id";--> statement-breakpoint
ALTER TABLE "restaurant_areas" RENAME COLUMN "id_uuid" TO "id";--> statement-breakpoint
ALTER TABLE "restaurant_areas" RENAME COLUMN "restaurant_id_uuid" TO "restaurant_id";--> statement-breakpoint
ALTER TABLE "restaurant_areas" ADD CONSTRAINT "restaurant_areas_pkey" PRIMARY KEY ("id");--> statement-breakpoint

ALTER TABLE "restaurant_meals" DROP COLUMN "restaurant_id";--> statement-breakpoint
ALTER TABLE "restaurant_meals" RENAME COLUMN "restaurant_id_uuid" TO "restaurant_id";--> statement-breakpoint
ALTER TABLE "restaurant_meals" ADD CONSTRAINT "restaurant_meals_restaurant_id_meal_type_pk" PRIMARY KEY ("restaurant_id", "meal_type");--> statement-breakpoint

ALTER TABLE "restaurant_to_types" DROP COLUMN "restaurant_id";--> statement-breakpoint
ALTER TABLE "restaurant_to_types" DROP COLUMN "restaurant_type_id";--> statement-breakpoint
ALTER TABLE "restaurant_to_types" RENAME COLUMN "restaurant_id_uuid" TO "restaurant_id";--> statement-breakpoint
ALTER TABLE "restaurant_to_types" RENAME COLUMN "restaurant_type_id_uuid" TO "restaurant_type_id";--> statement-breakpoint
ALTER TABLE "restaurant_to_types" ADD CONSTRAINT "restaurant_to_types_restaurant_id_restaurant_type_id_pk" PRIMARY KEY ("restaurant_id", "restaurant_type_id");--> statement-breakpoint

ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_areas" ADD CONSTRAINT "restaurant_areas_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_meals" ADD CONSTRAINT "restaurant_meals_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_to_types" ADD CONSTRAINT "restaurant_to_types_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_to_types" ADD CONSTRAINT "restaurant_to_types_restaurant_type_id_restaurant_types_id_fk" FOREIGN KEY ("restaurant_type_id") REFERENCES "public"."restaurant_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';--> statement-breakpoint

DROP TRIGGER IF EXISTS set_updated_at_countries ON "countries";--> statement-breakpoint
CREATE TRIGGER set_updated_at_countries BEFORE UPDATE ON "countries" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS set_updated_at_cities ON "cities";--> statement-breakpoint
CREATE TRIGGER set_updated_at_cities BEFORE UPDATE ON "cities" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS set_updated_at_restaurant_types ON "restaurant_types";--> statement-breakpoint
CREATE TRIGGER set_updated_at_restaurant_types BEFORE UPDATE ON "restaurant_types" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS set_updated_at_restaurants ON "restaurants";--> statement-breakpoint
CREATE TRIGGER set_updated_at_restaurants BEFORE UPDATE ON "restaurants" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS set_updated_at_restaurant_areas ON "restaurant_areas";--> statement-breakpoint
CREATE TRIGGER set_updated_at_restaurant_areas BEFORE UPDATE ON "restaurant_areas" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS set_updated_at_restaurant_meals ON "restaurant_meals";--> statement-breakpoint
CREATE TRIGGER set_updated_at_restaurant_meals BEFORE UPDATE ON "restaurant_meals" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS set_updated_at_restaurant_to_types ON "restaurant_to_types";--> statement-breakpoint
CREATE TRIGGER set_updated_at_restaurant_to_types BEFORE UPDATE ON "restaurant_to_types" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
