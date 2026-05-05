ALTER TABLE "restaurants" ADD COLUMN "rating" integer;

ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_rating_range" CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));
