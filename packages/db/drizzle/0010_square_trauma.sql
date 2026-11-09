CREATE TYPE "public"."order_line_kind" AS ENUM('volume', 'builder_set');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_payment', 'receipt_review', 'payment_confirmed', 'accepted', 'assembling', 'handed_to_bts', 'delivered', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."threshold_base" AS ENUM('before', 'after');--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"position" smallint NOT NULL,
	"kind" "order_line_kind" DEFAULT 'volume' NOT NULL,
	"volume_id" bigint,
	"fragrance_id" bigint,
	"slug" text,
	"name_ru" text NOT NULL,
	"name_uz" text NOT NULL,
	"brand" text,
	"ml" smallint NOT NULL,
	"photo" text,
	"unit_price" integer NOT NULL,
	"regular_unit_price" integer NOT NULL,
	"marked_down" boolean DEFAULT false NOT NULL,
	"qty" integer NOT NULL,
	"line_total" integer NOT NULL,
	"set_volume_ids" bigint[],
	"set_composition" jsonb,
	CONSTRAINT "order_lines_qty_check" CHECK ("order_lines"."qty" > 0),
	CONSTRAINT "order_lines_kind_check" CHECK (("order_lines"."kind" = 'volume' and "order_lines"."volume_id" is not null and "order_lines"."set_volume_ids" is null) or ("order_lines"."kind" = 'builder_set' and "order_lines"."volume_id" is null and cardinality("order_lines"."set_volume_ids") = 5)),
	CONSTRAINT "order_lines_money_check" CHECK ("order_lines"."unit_price" >= 0 and "order_lines"."regular_unit_price" >= 0 and "order_lines"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"customer_id" bigint NOT NULL,
	"status" "order_status" DEFAULT 'awaiting_payment' NOT NULL,
	"reserve_until" timestamp with time zone NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"region_id" bigint NOT NULL,
	"region_name_ru" text NOT NULL,
	"region_name_uz" text NOT NULL,
	"bts_point_id" bigint,
	"point_code" text,
	"point_name" text,
	"point_city" text,
	"point_address" text,
	"point_landmark" text,
	"point_hours" text,
	"typed_address" text,
	"comment" text,
	"is_gift" boolean DEFAULT false NOT NULL,
	"gift_message" text,
	"items_subtotal" integer NOT NULL,
	"discount" jsonb,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"delivery_fee" integer NOT NULL,
	"threshold_base" "threshold_base" NOT NULL,
	"threshold_base_amount" integer NOT NULL,
	"total" integer NOT NULL,
	"amount_due" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_point_or_typed" CHECK (("orders"."typed_address" is null and "orders"."point_code" is not null and "orders"."point_name" is not null and "orders"."point_city" is not null and "orders"."point_address" is not null) or ("orders"."typed_address" is not null and "orders"."bts_point_id" is null and "orders"."point_code" is null and "orders"."point_name" is null and "orders"."point_city" is null and "orders"."point_address" is null and "orders"."point_landmark" is null and "orders"."point_hours" is null)),
	CONSTRAINT "orders_gift_message" CHECK ("orders"."is_gift" or "orders"."gift_message" is null),
	CONSTRAINT "orders_money" CHECK ("orders"."items_subtotal" >= 0 and "orders"."discount_amount" >= 0 and "orders"."delivery_fee" >= 0 and "orders"."threshold_base_amount" >= 0 and "orders"."total" >= 0 and "orders"."amount_due" >= 0 and "orders"."amount_due" <= "orders"."total"),
	CONSTRAINT "orders_total_adds_up" CHECK ("orders"."total" = "orders"."items_subtotal" - "orders"."discount_amount" + "orders"."delivery_fee")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "data_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_volume_id_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."volumes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_fragrance_id_fragrances_id_fk" FOREIGN KEY ("fragrance_id") REFERENCES "public"."fragrances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_bts_point_id_bts_points_id_fk" FOREIGN KEY ("bts_point_id") REFERENCES "public"."bts_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_order_position_idx" ON "order_lines" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "order_lines_volume_idx" ON "order_lines" USING btree ("volume_id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_idempotency_idx" ON "orders" USING btree ("customer_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");