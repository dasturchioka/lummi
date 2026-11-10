CREATE TYPE "public"."cart_line_kind" AS ENUM('volume', 'builder_set', 'discovery_set');--> statement-breakpoint
ALTER TYPE "public"."order_line_kind" ADD VALUE 'discovery_set';--> statement-breakpoint
CREATE TABLE "discovery_set" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"price" integer NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"photo_hash" text,
	"is_placeholder" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_set_one_row" CHECK ("discovery_set"."id"),
	CONSTRAINT "discovery_set_money_check" CHECK ("discovery_set"."price" >= 0 and "discovery_set"."on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "discovery_set_items" (
	"position" smallint PRIMARY KEY NOT NULL,
	"fragrance_id" bigint NOT NULL,
	CONSTRAINT "discovery_set_items_fragrance_id_unique" UNIQUE("fragrance_id"),
	CONSTRAINT "discovery_set_items_position" CHECK ("discovery_set_items"."position" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_kind_check";--> statement-breakpoint
ALTER TABLE "cart_lines" ALTER COLUMN "volume_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_lines" ADD COLUMN "kind" "cart_line_kind" DEFAULT 'volume' NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_lines" ADD COLUMN "fragrance_ids" bigint[];--> statement-breakpoint
ALTER TABLE "discovery_set_items" ADD CONSTRAINT "discovery_set_items_fragrance_id_fragrances_id_fk" FOREIGN KEY ("fragrance_id") REFERENCES "public"."fragrances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_lines_customer_discovery_idx" ON "cart_lines" USING btree ("customer_id") WHERE kind = 'discovery_set';--> statement-breakpoint
CREATE UNIQUE INDEX "cart_lines_customer_builder_idx" ON "cart_lines" USING btree ("customer_id","fragrance_ids") WHERE kind = 'builder_set';--> statement-breakpoint
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_fragrance_ids_check" CHECK ("cart_lines"."fragrance_ids" is null or (cardinality("cart_lines"."fragrance_ids") = 5 and array_position("cart_lines"."fragrance_ids", null) is null));--> statement-breakpoint
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_kind_check" CHECK ((kind = 'volume' and volume_id is not null and fragrance_ids is null)
        or (kind = 'discovery_set' and volume_id is null and fragrance_ids is null)
        or (kind = 'builder_set' and volume_id is null and cardinality(fragrance_ids) = 5));--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_kind_check" CHECK (("order_lines"."kind"::text = 'volume' and "order_lines"."volume_id" is not null and "order_lines"."set_volume_ids" is null) or ("order_lines"."kind"::text = 'builder_set' and "order_lines"."volume_id" is null and cardinality("order_lines"."set_volume_ids") = 5 and jsonb_array_length("order_lines"."set_composition") = 5) or ("order_lines"."kind"::text = 'discovery_set' and "order_lines"."volume_id" is null and "order_lines"."set_volume_ids" is null and jsonb_array_length("order_lines"."set_composition") = 5));
--> statement-breakpoint
-- the one Discovery set row, with the placeholder price from docs/catalog-sample.md (ours, not the customer's)
INSERT INTO "discovery_set" ("id", "price", "on_hand", "is_placeholder") VALUES (true, 299000, 0, true);
