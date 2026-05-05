ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_tenant_id_id_unique" UNIQUE("tenant_id", "id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant_locations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "label" text,
  "address" text,
  "google_place_id" text,
  "google_maps_url" text,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "restaurant_locations_tenant_restaurant_fk" FOREIGN KEY ("tenant_id", "restaurant_id") REFERENCES "restaurants"("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "restaurant_locations_tenant_id_restaurant_id_google_place_id_unique" UNIQUE("tenant_id", "restaurant_id", "google_place_id"),
  CONSTRAINT "restaurant_locations_tenant_id_restaurant_id_id_unique" UNIQUE("tenant_id", "restaurant_id", "id")
);
--> statement-breakpoint
INSERT INTO "restaurant_locations" (
  "tenant_id",
  "restaurant_id",
  "address",
  "google_place_id",
  "google_maps_url",
  "latitude",
  "longitude",
  "created_at",
  "updated_at"
)
SELECT
  "tenant_id",
  "id",
  "address",
  "google_place_id",
  "url",
  "latitude",
  "longitude",
  "created_at",
  "updated_at"
FROM "restaurants"
WHERE "latitude" IS NOT NULL
  AND "longitude" IS NOT NULL
ON CONFLICT DO NOTHING;
