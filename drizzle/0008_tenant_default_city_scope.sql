DROP INDEX IF EXISTS "cities_single_default_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cities_single_default_per_tenant_idx"
ON "cities" ("tenant_id")
WHERE "is_default" = true;
