CREATE TYPE "public"."upgrade_right_source" AS ENUM('set', 'single_10ml');--> statement-breakpoint
CREATE TABLE "upgrade_rights" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upgrade_rights_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_id" bigint NOT NULL,
	"source" "upgrade_right_source" NOT NULL,
	"source_order_id" bigint NOT NULL,
	"source_position" smallint NOT NULL,
	"source_unit" smallint NOT NULL,
	"fragrances" jsonb NOT NULL,
	"percent" smallint NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by_order_id" bigint,
	"closed_at" timestamp with time zone,
	"first_reminder_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upgrade_rights_terms_check" CHECK ("upgrade_rights"."percent" between 1 and 100 and "upgrade_rights"."expires_at" > "upgrade_rights"."opened_at" and jsonb_array_length("upgrade_rights"."fragrances") between 1 and 5 and "upgrade_rights"."source_unit" >= 0)
);
--> statement-breakpoint
ALTER TABLE "upgrade_rights" ADD CONSTRAINT "upgrade_rights_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_rights" ADD CONSTRAINT "upgrade_rights_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_rights" ADD CONSTRAINT "upgrade_rights_used_by_order_id_orders_id_fk" FOREIGN KEY ("used_by_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upgrade_rights_source_idx" ON "upgrade_rights" USING btree ("source_order_id","source_position","source_unit");--> statement-breakpoint
CREATE UNIQUE INDEX "upgrade_rights_used_by_order_idx" ON "upgrade_rights" USING btree ("used_by_order_id") WHERE "upgrade_rights"."used_by_order_id" is not null;--> statement-breakpoint
CREATE INDEX "upgrade_rights_customer_idx" ON "upgrade_rights" USING btree ("customer_id","expires_at");