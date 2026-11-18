CREATE TYPE "public"."stock_move_kind" AS ENUM('receipt', 'receipt_corrected', 'receipt_voided', 'bottling', 'sale', 'returned', 'correction');--> statement-breakpoint
CREATE TABLE "bottlings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bottlings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"fragrance_id" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"oil_mg" integer NOT NULL,
	"ethanol_ml" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bottlings_amounts_check" CHECK ("bottlings"."oil_mg" >= 0 and "bottlings"."ethanol_ml" >= 0)
);
--> statement-breakpoint
CREATE TABLE "oil_receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oil_receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"fragrance_id" bigint NOT NULL,
	"supplier" text NOT NULL,
	"invoice" text NOT NULL,
	"received_on" date NOT NULL,
	"oil_mg" integer NOT NULL,
	"price_per_gram" integer NOT NULL,
	"discount_percent" numeric(5, 2) NOT NULL,
	"import_percent" numeric(5, 2) NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oil_receipts_amounts_check" CHECK ("oil_receipts"."oil_mg" > 0 and "oil_receipts"."price_per_gram" > 0
        and "oil_receipts"."discount_percent" between 0 and 100 and "oil_receipts"."import_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"fragrance_id" bigint NOT NULL,
	"kind" "stock_move_kind" NOT NULL,
	"oil_mg" integer DEFAULT 0 NOT NULL,
	"bottles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"receipt_id" bigint,
	"bottling_id" bigint,
	"order_id" bigint,
	"reason" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fragrances" ADD COLUMN "oil_mg" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bottlings" ADD CONSTRAINT "bottlings_fragrance_id_fragrances_id_fk" FOREIGN KEY ("fragrance_id") REFERENCES "public"."fragrances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oil_receipts" ADD CONSTRAINT "oil_receipts_fragrance_id_fragrances_id_fk" FOREIGN KEY ("fragrance_id") REFERENCES "public"."fragrances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_receipt_id_oil_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."oil_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_bottling_id_bottlings_id_fk" FOREIGN KEY ("bottling_id") REFERENCES "public"."bottlings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bottlings_fragrance_idx" ON "bottlings" USING btree ("fragrance_id","id");--> statement-breakpoint
CREATE INDEX "oil_receipts_fragrance_idx" ON "oil_receipts" USING btree ("fragrance_id","id");--> statement-breakpoint
CREATE INDEX "stock_moves_fragrance_idx" ON "stock_moves" USING btree ("fragrance_id","id");--> statement-breakpoint
CREATE INDEX "stock_moves_created_idx" ON "stock_moves" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "fragrances" ADD CONSTRAINT "fragrances_oil_mg_check" CHECK ("fragrances"."oil_mg" >= 0);