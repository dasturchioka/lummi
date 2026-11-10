CREATE TYPE "public"."receipt_file_kind" AS ENUM('jpeg', 'png', 'webp', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."receipt_source" AS ENUM('miniapp', 'bot');--> statement-breakpoint
CREATE TYPE "public"."receipt_verdict" AS ENUM('pending', 'ai_confirmed', 'manual_review', 'manager_confirmed', 'rejected', 'payment_not_found');--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"source" "receipt_source" NOT NULL,
	"verdict" "receipt_verdict" DEFAULT 'pending' NOT NULL,
	"file_name" text,
	"kind" "receipt_file_kind" NOT NULL,
	"size" integer NOT NULL,
	"original_key" text NOT NULL,
	"normalized_key" text NOT NULL,
	"normalized_mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"phash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_original_key_unique" UNIQUE("original_key"),
	CONSTRAINT "receipts_normalized_key_unique" UNIQUE("normalized_key"),
	CONSTRAINT "receipts_size" CHECK ("receipts"."size" > 0),
	CONSTRAINT "receipts_sha256" CHECK ("receipts"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "receipts_phash" CHECK ("receipts"."phash" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "receipts_normalized_mime" CHECK ("receipts"."normalized_mime" in ('image/png', 'image/jpeg')),
	CONSTRAINT "receipts_judge_size" CHECK ("receipts"."width" between 280 and 1568 and "receipts"."height" between 280 and 1568)
);
--> statement-breakpoint
CREATE TABLE "shop_card" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"number" text NOT NULL,
	"holder" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_card_one_row" CHECK ("shop_card"."id"),
	CONSTRAINT "shop_card_number" CHECK ("shop_card"."number" ~ '^[0-9]{16}$')
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_order_idx" ON "receipts" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "receipts_sha256_idx" ON "receipts" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "receipts_phash_idx" ON "receipts" USING btree ("phash");