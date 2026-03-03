CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subdomain" text,
	"display_name" text NOT NULL,
	"admin_username" text,
	"admin_password_hash" text,
	"is_root" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_is_root_unique_idx" ON "tenants" ("is_root") WHERE "is_root" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_subdomain_unique_idx" ON "tenants" ("subdomain") WHERE "subdomain" IS NOT NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "tenants" WHERE "is_root" = true) THEN
    INSERT INTO "tenants" ("display_name", "is_root")
    VALUES ('Dean', true);
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "countries" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "restaurant_types" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint

WITH root_tenant AS (
  SELECT "id" FROM "tenants" WHERE "is_root" = true LIMIT 1
)
UPDATE "countries"
SET "tenant_id" = (SELECT "id" FROM root_tenant)
WHERE "tenant_id" IS NULL;
--> statement-breakpoint
WITH root_tenant AS (
  SELECT "id" FROM "tenants" WHERE "is_root" = true LIMIT 1
)
UPDATE "cities"
SET "tenant_id" = (SELECT "id" FROM root_tenant)
WHERE "tenant_id" IS NULL;
--> statement-breakpoint
WITH root_tenant AS (
  SELECT "id" FROM "tenants" WHERE "is_root" = true LIMIT 1
)
UPDATE "restaurant_types"
SET "tenant_id" = (SELECT "id" FROM root_tenant)
WHERE "tenant_id" IS NULL;
--> statement-breakpoint
WITH root_tenant AS (
  SELECT "id" FROM "tenants" WHERE "is_root" = true LIMIT 1
)
UPDATE "restaurants"
SET "tenant_id" = (SELECT "id" FROM root_tenant)
WHERE "tenant_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "countries" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurant_types" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurants" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "countries" DROP CONSTRAINT IF EXISTS "countries_name_unique";
--> statement-breakpoint
ALTER TABLE "restaurant_types" DROP CONSTRAINT IF EXISTS "restaurant_types_name_unique";
--> statement-breakpoint
ALTER TABLE "cities" DROP CONSTRAINT IF EXISTS "cities_country_id_name_unique";
--> statement-breakpoint

ALTER TABLE "countries" ADD CONSTRAINT "countries_tenant_id_name_unique" UNIQUE ("tenant_id", "name");
--> statement-breakpoint
ALTER TABLE "restaurant_types" ADD CONSTRAINT "restaurant_types_tenant_id_name_unique" UNIQUE ("tenant_id", "name");
--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_tenant_id_country_id_name_unique" UNIQUE ("tenant_id", "country_id", "name");
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "countries" ADD CONSTRAINT "countries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cities" ADD CONSTRAINT "cities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurant_types" ADD CONSTRAINT "restaurant_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS set_updated_at_tenants ON "tenants";
--> statement-breakpoint
CREATE TRIGGER set_updated_at_tenants BEFORE UPDATE ON "tenants" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
