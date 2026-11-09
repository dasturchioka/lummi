CREATE TABLE "bts_points" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bts_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"region_id" bigint NOT NULL,
	"city" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"landmark" text,
	"hours" text,
	"active" boolean DEFAULT true NOT NULL,
	"search_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bts_points_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "regions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"bts_id" integer NOT NULL,
	"name_ru" text NOT NULL,
	"name_uz" text NOT NULL,
	"delivery_tariff" integer NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_code_unique" UNIQUE("code"),
	CONSTRAINT "regions_bts_id_unique" UNIQUE("bts_id")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "delivery_region_id" bigint;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "delivery_city" text;--> statement-breakpoint
ALTER TABLE "bts_points" ADD CONSTRAINT "bts_points_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bts_points_region_city_idx" ON "bts_points" USING btree ("region_id","city");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_delivery_region_id_regions_id_fk" FOREIGN KEY ("delivery_region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;