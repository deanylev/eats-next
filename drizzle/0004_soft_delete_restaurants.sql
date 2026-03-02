ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
