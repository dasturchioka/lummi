ALTER TABLE "volumes" DROP CONSTRAINT "volumes_ml_check";--> statement-breakpoint
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_ml_check" CHECK ("volumes"."ml" in (5, 10, 30, 50));--> statement-breakpoint
ALTER TABLE "discovery_set_items" DROP CONSTRAINT "discovery_set_items_fragrance_id_unique";--> statement-breakpoint
ALTER TABLE "discovery_set_items" DROP CONSTRAINT "discovery_set_items_pkey";--> statement-breakpoint
ALTER TABLE "discovery_set" DROP CONSTRAINT "discovery_set_one_row";--> statement-breakpoint
ALTER TABLE "discovery_set" ADD COLUMN "vial_ml" smallint;--> statement-breakpoint
UPDATE "discovery_set" SET "vial_ml" = 10;--> statement-breakpoint
ALTER TABLE "discovery_set" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "discovery_set" ALTER COLUMN "vial_ml" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_set" ADD PRIMARY KEY ("vial_ml");--> statement-breakpoint
ALTER TABLE "discovery_set" ADD CONSTRAINT "discovery_set_vial_ml_check" CHECK ("discovery_set"."vial_ml" in (5, 10));--> statement-breakpoint
ALTER TABLE "discovery_set_items" ADD COLUMN "vial_ml" smallint;--> statement-breakpoint
UPDATE "discovery_set_items" SET "vial_ml" = 10;--> statement-breakpoint
ALTER TABLE "discovery_set_items" ALTER COLUMN "vial_ml" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_set_items" ADD CONSTRAINT "discovery_set_items_vial_ml_position_pk" PRIMARY KEY("vial_ml","position");--> statement-breakpoint
ALTER TABLE "discovery_set_items" ADD CONSTRAINT "discovery_set_items_vial_ml_discovery_set_vial_ml_fk" FOREIGN KEY ("vial_ml") REFERENCES "public"."discovery_set"("vial_ml") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_set_items_fragrance_idx" ON "discovery_set_items" USING btree ("vial_ml","fragrance_id");--> statement-breakpoint
ALTER TABLE "cart_lines" DROP CONSTRAINT "cart_lines_kind_check";--> statement-breakpoint
DROP INDEX "cart_lines_customer_discovery_idx";--> statement-breakpoint
ALTER TABLE "cart_lines" ADD COLUMN "vial_ml" smallint;--> statement-breakpoint
UPDATE "cart_lines" SET "vial_ml" = 10 WHERE "kind" = 'discovery_set';--> statement-breakpoint
CREATE UNIQUE INDEX "cart_lines_customer_discovery_idx" ON "cart_lines" USING btree ("customer_id","vial_ml") WHERE kind = 'discovery_set';--> statement-breakpoint
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_kind_check" CHECK ((kind = 'volume' and volume_id is not null and fragrance_ids is null and vial_ml is null)
        or (kind = 'discovery_set' and volume_id is null and fragrance_ids is null and vial_ml in (5, 10))
        or (kind = 'builder_set' and volume_id is null and cardinality(fragrance_ids) = 5 and vial_ml is null));--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "gift_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_gift_sample_check" CHECK (not "order_lines"."gift_sample" or ("order_lines"."kind"::text = 'volume' and not "order_lines"."promo_gift" and "order_lines"."unit_price" = 0 and "order_lines"."regular_unit_price" = 0 and "order_lines"."line_total" = 0 and "order_lines"."qty" = 1));--> statement-breakpoint
ALTER TABLE "bottlings" ADD COLUMN "set_vial_ml" smallint;--> statement-breakpoint
ALTER TABLE "bottlings" ADD CONSTRAINT "bottlings_set_vial_ml_check" CHECK ("bottlings"."set_vial_ml" is null or "bottlings"."set_vial_ml" in (5, 10));--> statement-breakpoint

-- «Discovery Set 5×5 мл» (#79) at the calculator's price; a placeholder until the owner saves it, its five start as the 5 × 10 ml set's
INSERT INTO "discovery_set" ("vial_ml", "price", "on_hand", "is_placeholder") VALUES (5, 99000, 0, true);--> statement-breakpoint
INSERT INTO "discovery_set_items" ("vial_ml", "position", "fragrance_id") SELECT 5, "position", "fragrance_id" FROM "discovery_set_items" WHERE "vial_ml" = 10;--> statement-breakpoint
-- every fragrance's 5 ml bottle (ADR 0042): stocked and bottled, never sold alone, so no price
INSERT INTO "volumes" ("fragrance_id", "ml", "price", "on_hand", "is_placeholder") SELECT "id", 5, 0, 0, false FROM "fragrances" ON CONFLICT DO NOTHING;
