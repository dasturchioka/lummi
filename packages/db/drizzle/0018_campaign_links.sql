CREATE TYPE "public"."campaign_source" AS ENUM('instagram', 'telegram_channel', 'store_qr', 'blogger', 'other');--> statement-breakpoint
CREATE TABLE "campaign_links" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "campaign_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"target" text NOT NULL,
	"promo_code_id" bigint,
	"source" "campaign_source" NOT NULL,
	"source_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_links_code_check" CHECK ("campaign_links"."code" ~ '^[A-Za-z0-9_-]{3,40}$')
);
--> statement-breakpoint
CREATE TABLE "campaign_opens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "campaign_opens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"link_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "acquisition_link_id" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "campaign_link_id" bigint;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_opens" ADD CONSTRAINT "campaign_opens_link_id_campaign_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."campaign_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_opens" ADD CONSTRAINT "campaign_opens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_links_code_idx" ON "campaign_links" USING btree (lower("code"));--> statement-breakpoint
CREATE INDEX "campaign_links_promo_idx" ON "campaign_links" USING btree ("promo_code_id");--> statement-breakpoint
CREATE INDEX "campaign_opens_customer_idx" ON "campaign_opens" USING btree ("customer_id","opened_at");--> statement-breakpoint
CREATE INDEX "campaign_opens_link_idx" ON "campaign_opens" USING btree ("link_id","customer_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_acquisition_link_id_campaign_links_id_fk" FOREIGN KEY ("acquisition_link_id") REFERENCES "public"."campaign_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_campaign_link_id_campaign_links_id_fk" FOREIGN KEY ("campaign_link_id") REFERENCES "public"."campaign_links"("id") ON DELETE no action ON UPDATE no action;