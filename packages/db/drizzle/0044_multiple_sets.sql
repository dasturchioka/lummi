-- More Discovery sets (2026-11-28, ADR 0044): a set is keyed by its text `key`, not by the ml of
-- its vials. The two there are keep the keys the panel already used: `discovery` (5 × 10 ml) and
-- `discovery-5` (5 × 5 ml); their names come from the shop's texts of the day.
ALTER TABLE "bottlings" DROP CONSTRAINT "bottlings_set_vial_ml_check";--> statement-breakpoint
ALTER TABLE "cart_lines" DROP CONSTRAINT "cart_lines_kind_check";--> statement-breakpoint
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_kind_check";--> statement-breakpoint
ALTER TABLE "discovery_set_items" DROP CONSTRAINT "discovery_set_items_vial_ml_discovery_set_vial_ml_fk";--> statement-breakpoint
DROP INDEX "cart_lines_customer_discovery_idx";--> statement-breakpoint
DROP INDEX "discovery_set_items_fragrance_idx";--> statement-breakpoint
ALTER TABLE "discovery_set_items" DROP CONSTRAINT "discovery_set_items_vial_ml_position_pk";--> statement-breakpoint
ALTER TABLE "discovery_set" DROP CONSTRAINT "discovery_set_pkey";--> statement-breakpoint
-- the sets themselves
ALTER TABLE "discovery_set" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "discovery_set" ADD COLUMN "name_ru" text;--> statement-breakpoint
ALTER TABLE "discovery_set" ADD COLUMN "name_uz" text;--> statement-breakpoint
ALTER TABLE "discovery_set" ADD COLUMN "position" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_set" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "discovery_set" SET
  "key" = CASE "vial_ml" WHEN 10 THEN 'discovery' ELSE 'discovery-5' END,
  "name_ru" = CASE "vial_ml" WHEN 10 THEN 'Discovery set' ELSE 'Discovery set 5 × 5 мл' END,
  "name_uz" = CASE "vial_ml" WHEN 10 THEN 'Discovery set' ELSE 'Discovery set 5 × 5 ml' END,
  "position" = CASE "vial_ml" WHEN 10 THEN 0 ELSE 1 END;--> statement-breakpoint
ALTER TABLE "discovery_set" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_set" ALTER COLUMN "name_ru" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_set" ALTER COLUMN "name_uz" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_set" ADD PRIMARY KEY ("key");--> statement-breakpoint
ALTER TABLE "discovery_set" ADD CONSTRAINT "discovery_set_key_check" CHECK ("discovery_set"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
-- their compositions
ALTER TABLE "discovery_set_items" ADD COLUMN "set_key" text;--> statement-breakpoint
UPDATE "discovery_set_items" SET "set_key" = CASE "vial_ml" WHEN 10 THEN 'discovery' ELSE 'discovery-5' END;--> statement-breakpoint
ALTER TABLE "discovery_set_items" ALTER COLUMN "set_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_set_items" DROP COLUMN "vial_ml";--> statement-breakpoint
ALTER TABLE "discovery_set_items" ADD CONSTRAINT "discovery_set_items_set_key_position_pk" PRIMARY KEY("set_key","position");--> statement-breakpoint
ALTER TABLE "discovery_set_items" ADD CONSTRAINT "discovery_set_items_set_key_discovery_set_key_fk" FOREIGN KEY ("set_key") REFERENCES "public"."discovery_set"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_set_items_fragrance_idx" ON "discovery_set_items" USING btree ("set_key","fragrance_id");--> statement-breakpoint
-- cart lines
ALTER TABLE "cart_lines" ADD COLUMN "set_key" text;--> statement-breakpoint
UPDATE "cart_lines" SET "set_key" = CASE "vial_ml" WHEN 10 THEN 'discovery' ELSE 'discovery-5' END WHERE "kind" = 'discovery_set';--> statement-breakpoint
ALTER TABLE "cart_lines" DROP COLUMN "vial_ml";--> statement-breakpoint
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_set_key_discovery_set_key_fk" FOREIGN KEY ("set_key") REFERENCES "public"."discovery_set"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_lines_customer_discovery_idx" ON "cart_lines" USING btree ("customer_id","set_key") WHERE kind = 'discovery_set';--> statement-breakpoint
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_kind_check" CHECK ((kind = 'volume' and volume_id is not null and fragrance_ids is null and set_key is null)
        or (kind = 'discovery_set' and volume_id is null and fragrance_ids is null and set_key is not null)
        or (kind = 'builder_set' and volume_id is null and cardinality(fragrance_ids) = 5 and set_key is null));--> statement-breakpoint
-- order lines: a Discovery line's `ml` was its vial size, and so its set
ALTER TABLE "order_lines" ADD COLUMN "set_key" text;--> statement-breakpoint
UPDATE "order_lines" SET "set_key" = CASE "ml" WHEN 5 THEN 'discovery-5' ELSE 'discovery' END WHERE "kind" = 'discovery_set';--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_kind_check" CHECK (("order_lines"."kind"::text = 'volume' and "order_lines"."volume_id" is not null and "order_lines"."set_volume_ids" is null) or ("order_lines"."kind"::text = 'builder_set' and "order_lines"."volume_id" is null and cardinality("order_lines"."set_volume_ids") = 5 and jsonb_array_length("order_lines"."set_composition") = 5) or ("order_lines"."kind"::text = 'discovery_set' and "order_lines"."volume_id" is null and "order_lines"."set_volume_ids" is null and "order_lines"."set_key" is not null and jsonb_array_length("order_lines"."set_composition") = 5));--> statement-breakpoint
-- set bottlings
ALTER TABLE "bottlings" ADD COLUMN "set_key" text;--> statement-breakpoint
UPDATE "bottlings" SET "set_key" = CASE "set_vial_ml" WHEN 10 THEN 'discovery' ELSE 'discovery-5' END WHERE "set_vial_ml" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bottlings" DROP COLUMN "set_vial_ml";--> statement-breakpoint
-- Uzum sale lines: the same reading of `ml`
ALTER TABLE "uzum_sale_lines" ADD COLUMN "set_key" text;--> statement-breakpoint
UPDATE "uzum_sale_lines" SET "set_key" = CASE "ml" WHEN 5 THEN 'discovery-5' ELSE 'discovery' END WHERE "kind" = 'discovery_set';--> statement-breakpoint
ALTER TABLE "uzum_sale_lines" ADD CONSTRAINT "uzum_sale_lines_set_check" CHECK (("uzum_sale_lines"."kind" = 'discovery_set') = ("uzum_sale_lines"."set_key" is not null));
