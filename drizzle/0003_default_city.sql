ALTER TABLE "cities" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cities_single_default_idx" ON "cities" ("is_default") WHERE "is_default" = true;
