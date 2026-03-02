CREATE UNIQUE INDEX IF NOT EXISTS "restaurants_unique_active_city_name_idx"
ON "restaurants" ("city_id", lower("name"))
WHERE "deleted_at" IS NULL;
