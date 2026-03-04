ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "primary_color" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "secondary_color" text;
--> statement-breakpoint

UPDATE "tenants"
SET "primary_color" = '#1b0426'
WHERE "primary_color" IS NULL;
--> statement-breakpoint
UPDATE "tenants"
SET "secondary_color" = '#e8a61a'
WHERE "secondary_color" IS NULL;
--> statement-breakpoint

ALTER TABLE "tenants" ALTER COLUMN "primary_color" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "secondary_color" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "tenants" ALTER COLUMN "primary_color" SET DEFAULT '#1b0426';
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "secondary_color" SET DEFAULT '#e8a61a';
