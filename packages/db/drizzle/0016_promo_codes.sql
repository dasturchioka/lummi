CREATE TYPE "public"."promo_kind" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TABLE "promo_code_uses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "promo_code_uses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"promo_code_id" bigint NOT NULL,
	"order_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "promo_code_uses_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "promo_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"kind" "promo_kind" NOT NULL,
	"percent" smallint,
	"amount" integer,
	"max_discount" integer,
	"expires_at" timestamp with time zone,
	"min_order_total" integer,
	"total_limit" integer,
	"per_customer_limit" integer,
	"new_customers_only" boolean DEFAULT false NOT NULL,
	"applies_to_marked_down" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "promo_codes_code_check" CHECK ("promo_codes"."code" = upper(btrim("promo_codes"."code")) and "promo_codes"."code" <> ''),
	CONSTRAINT "promo_codes_terms_check" CHECK (("promo_codes"."kind" = 'percent' and "promo_codes"."percent" between 1 and 100 and "promo_codes"."amount" is null) or ("promo_codes"."kind" = 'fixed' and "promo_codes"."amount" > 0 and "promo_codes"."percent" is null and "promo_codes"."max_discount" is null)),
	CONSTRAINT "promo_codes_limits_check" CHECK (coalesce("promo_codes"."max_discount", 1) > 0 and coalesce("promo_codes"."min_order_total", 0) >= 0 and coalesce("promo_codes"."total_limit", 1) > 0 and coalesce("promo_codes"."per_customer_limit", 1) > 0)
);
--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "promo_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "promo_attempts_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "promo_code_uses" ADD CONSTRAINT "promo_code_uses_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_uses" ADD CONSTRAINT "promo_code_uses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_uses" ADD CONSTRAINT "promo_code_uses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promo_code_uses_counted_idx" ON "promo_code_uses" USING btree ("promo_code_id","customer_id") WHERE "promo_code_uses"."voided_at" is null;