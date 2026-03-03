ALTER TABLE "countries"
ADD CONSTRAINT "countries_tenant_id_id_unique" UNIQUE ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "cities"
ADD CONSTRAINT "cities_tenant_id_id_unique" UNIQUE ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "restaurant_types"
ADD CONSTRAINT "restaurant_types_tenant_id_id_unique" UNIQUE ("tenant_id", "id");
--> statement-breakpoint

ALTER TABLE "cities" DROP CONSTRAINT IF EXISTS "cities_country_id_countries_id_fk";
--> statement-breakpoint
ALTER TABLE "restaurants" DROP CONSTRAINT IF EXISTS "restaurants_city_id_cities_id_fk";
--> statement-breakpoint

ALTER TABLE "cities"
ADD CONSTRAINT "cities_tenant_country_fk"
FOREIGN KEY ("tenant_id", "country_id")
REFERENCES "countries" ("tenant_id", "id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "restaurants"
ADD CONSTRAINT "restaurants_tenant_city_fk"
FOREIGN KEY ("tenant_id", "city_id")
REFERENCES "cities" ("tenant_id", "id")
ON DELETE restrict
ON UPDATE no action;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_restaurant_to_types_tenant_match()
RETURNS TRIGGER AS $$
DECLARE
  restaurant_tenant uuid;
  type_tenant uuid;
BEGIN
  SELECT tenant_id INTO restaurant_tenant FROM restaurants WHERE id = NEW.restaurant_id;
  SELECT tenant_id INTO type_tenant FROM restaurant_types WHERE id = NEW.restaurant_type_id;

  IF restaurant_tenant IS NULL OR type_tenant IS NULL THEN
    RAISE EXCEPTION 'Invalid restaurant/type reference'
      USING ERRCODE = '23503';
  END IF;

  IF restaurant_tenant <> type_tenant THEN
    RAISE EXCEPTION 'Cross-tenant restaurant/type link is not allowed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "restaurant_to_types_tenant_guard" ON "restaurant_to_types";
--> statement-breakpoint
CREATE TRIGGER "restaurant_to_types_tenant_guard"
BEFORE INSERT OR UPDATE ON "restaurant_to_types"
FOR EACH ROW
EXECUTE FUNCTION enforce_restaurant_to_types_tenant_match();
