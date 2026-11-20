CREATE TYPE "public"."uzum_sale_line_kind" AS ENUM('volume', 'discovery_set');--> statement-breakpoint
CREATE TYPE "public"."uzum_sale_source" AS ENUM('form', 'import');--> statement-breakpoint
ALTER TYPE "public"."stock_move_kind" ADD VALUE 'uzum_sale';--> statement-breakpoint
ALTER TYPE "public"."stock_move_kind" ADD VALUE 'uzum_sale_voided';--> statement-breakpoint
CREATE TABLE "uzum_sale_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "uzum_sale_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sale_id" bigint NOT NULL,
	"position" smallint NOT NULL,
	"kind" "uzum_sale_line_kind" NOT NULL,
	"volume_id" bigint,
	"fragrance_id" bigint,
	"name" text,
	"ml" smallint NOT NULL,
	"qty" integer NOT NULL,
	"price" integer NOT NULL,
	"line_total" integer NOT NULL,
	"unit_cost" integer,
	"set_fragrance_ids" bigint[],
	CONSTRAINT "uzum_sale_lines_item_check" CHECK (("uzum_sale_lines"."kind" = 'volume') = ("uzum_sale_lines"."volume_id" is not null and "uzum_sale_lines"."fragrance_id" is not null)),
	CONSTRAINT "uzum_sale_lines_amounts_check" CHECK ("uzum_sale_lines"."qty" > 0 and "uzum_sale_lines"."price" >= 0 and "uzum_sale_lines"."line_total" = "uzum_sale_lines"."qty" * "uzum_sale_lines"."price")
);
--> statement-breakpoint
CREATE TABLE "uzum_sales" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "uzum_sales_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sold_on" date NOT NULL,
	"uzum_order" text NOT NULL,
	"commission_percent" numeric(5, 2) NOT NULL,
	"revenue" integer NOT NULL,
	"costs" jsonb NOT NULL,
	"source" "uzum_sale_source" NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"voided_by" bigint,
	CONSTRAINT "uzum_sales_amounts_check" CHECK ("uzum_sales"."revenue" >= 0 and "uzum_sales"."commission_percent" between 0 and 100),
	CONSTRAINT "uzum_sales_void_check" CHECK (("uzum_sales"."voided_at" is null) = ("uzum_sales"."void_reason" is null) and ("uzum_sales"."voided_at" is null) = ("uzum_sales"."voided_by" is null))
);
--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "uzum_sale_id" bigint;--> statement-breakpoint
ALTER TABLE "uzum_sale_lines" ADD CONSTRAINT "uzum_sale_lines_sale_id_uzum_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."uzum_sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uzum_sale_lines" ADD CONSTRAINT "uzum_sale_lines_volume_id_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."volumes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uzum_sales" ADD CONSTRAINT "uzum_sales_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uzum_sales" ADD CONSTRAINT "uzum_sales_voided_by_staff_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uzum_sale_lines_position_idx" ON "uzum_sale_lines" USING btree ("sale_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "uzum_sales_standing_order_idx" ON "uzum_sales" USING btree ("uzum_order") WHERE "uzum_sales"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "uzum_sales_sold_on_idx" ON "uzum_sales" USING btree ("sold_on");--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_uzum_sale_id_uzum_sales_id_fk" FOREIGN KEY ("uzum_sale_id") REFERENCES "public"."uzum_sales"("id") ON DELETE restrict ON UPDATE no action;