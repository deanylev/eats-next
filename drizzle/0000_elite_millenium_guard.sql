DO $$ BEGIN
 CREATE TYPE "public"."meal_type" AS ENUM('snack', 'breakfast', 'lunch', 'dinner');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."restaurant_status" AS ENUM('untried', 'liked', 'disliked');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cities" (
	"id" serial PRIMARY KEY NOT NULL,
	"country_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_country_id_name_unique" UNIQUE("country_id","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "countries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "countries_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"area" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_meals" (
	"restaurant_id" integer NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	CONSTRAINT "restaurant_meals_restaurant_id_meal_type_pk" PRIMARY KEY("restaurant_id","meal_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_to_types" (
	"restaurant_id" integer NOT NULL,
	"restaurant_type_id" integer NOT NULL,
	CONSTRAINT "restaurant_to_types_restaurant_id_restaurant_type_id_pk" PRIMARY KEY("restaurant_id","restaurant_type_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurants" (
	"id" serial PRIMARY KEY NOT NULL,
	"city_id" integer NOT NULL,
	"name" text NOT NULL,
	"notes" text NOT NULL,
	"referred_by" text NOT NULL,
	"url" text NOT NULL,
	"status" "restaurant_status" NOT NULL,
	"disliked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurant_areas" ADD CONSTRAINT "restaurant_areas_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurant_meals" ADD CONSTRAINT "restaurant_meals_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurant_to_types" ADD CONSTRAINT "restaurant_to_types_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurant_to_types" ADD CONSTRAINT "restaurant_to_types_restaurant_type_id_restaurant_types_id_fk" FOREIGN KEY ("restaurant_type_id") REFERENCES "public"."restaurant_types"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
