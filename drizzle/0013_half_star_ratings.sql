ALTER TABLE "restaurants" DROP CONSTRAINT IF EXISTS "restaurants_rating_range";
UPDATE "restaurants" SET "rating" = "rating" * 2 WHERE "rating" IS NOT NULL;
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_rating_range" CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 10));
