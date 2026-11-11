CREATE TABLE "birthday_coupons" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birthday_coupons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_id" bigint NOT NULL,
	"birthday_year" integer NOT NULL,
	"birthday" date NOT NULL,
	"percent" smallint NOT NULL,
	"max_amount" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by_order_id" bigint,
	"outbox_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "birthday_coupons_terms_check" CHECK ("birthday_coupons"."percent" between 1 and 100 and "birthday_coupons"."max_amount" >= 0 and "birthday_coupons"."expires_at" > "birthday_coupons"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "birth_date_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "birthday_coupons" ADD CONSTRAINT "birthday_coupons_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_coupons" ADD CONSTRAINT "birthday_coupons_used_by_order_id_orders_id_fk" FOREIGN KEY ("used_by_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "birthday_coupons_customer_year_idx" ON "birthday_coupons" USING btree ("customer_id","birthday_year");--> statement-breakpoint
CREATE UNIQUE INDEX "birthday_coupons_used_by_order_idx" ON "birthday_coupons" USING btree ("used_by_order_id") WHERE "birthday_coupons"."used_by_order_id" is not null;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_birth_date_check" CHECK (("customers"."birth_date" is null) = ("customers"."birth_date_set_at" is null));