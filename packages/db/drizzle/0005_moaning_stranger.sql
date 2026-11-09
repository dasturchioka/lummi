CREATE TYPE "public"."fragrance_type" AS ENUM('homme', 'femme', 'unisex');--> statement-breakpoint
CREATE TYPE "public"."note_level" AS ENUM('top', 'heart', 'base');--> statement-breakpoint
CREATE TYPE "public"."season" AS ENUM('spring_summer', 'autumn_winter', 'all_year', 'spring_autumn');--> statement-breakpoint
CREATE TYPE "public"."sillage" AS ENUM('medium', 'noticeable', 'strong');--> statement-breakpoint
CREATE TYPE "public"."time_of_day" AS ENUM('day', 'evening', 'day_evening', 'everyday');--> statement-breakpoint
CREATE TABLE "families" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "families_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name_ru" text NOT NULL,
	"name_uz" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "families_name_ru_unique" UNIQUE("name_ru"),
	CONSTRAINT "families_name_uz_unique" UNIQUE("name_uz")
);
--> statement-breakpoint
CREATE TABLE "fragrance_notes" (
	"fragrance_id" bigint NOT NULL,
	"note_id" bigint NOT NULL,
	"level" "note_level" NOT NULL,
	"position" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fragrance_similar" (
	"fragrance_id" bigint NOT NULL,
	"similar_id" bigint NOT NULL,
	"position" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fragrances" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fragrances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"original_brand" text NOT NULL,
	"type" "fragrance_type" NOT NULL,
	"family_id" bigint,
	"season" "season" NOT NULL,
	"time_of_day" time_of_day NOT NULL,
	"longevity_ru" text NOT NULL,
	"longevity_uz" text NOT NULL,
	"sillage" "sillage" NOT NULL,
	"description_ru" text NOT NULL,
	"description_uz" text NOT NULL,
	"when_to_wear_ru" text NOT NULL,
	"when_to_wear_uz" text NOT NULL,
	"key_notes_ru" text[] NOT NULL,
	"key_notes_uz" text[] NOT NULL,
	"internal_remark" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"uzum_url" text,
	"is_hit" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fragrances_slug_unique" UNIQUE("slug"),
	CONSTRAINT "fragrances_code_unique" UNIQUE("code"),
	CONSTRAINT "fragrances_three_key_notes" CHECK (cardinality("fragrances"."key_notes_ru") = 3 and cardinality("fragrances"."key_notes_uz") = 3)
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name_ru" text NOT NULL,
	"name_uz" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "notes_name_ru_unique" UNIQUE("name_ru")
);
--> statement-breakpoint
CREATE TABLE "volumes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volumes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"fragrance_id" bigint NOT NULL,
	"ml" smallint NOT NULL,
	"price" integer NOT NULL,
	"sale_price" integer,
	"sale_ends_at" timestamp with time zone,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"photo_hash" text,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	CONSTRAINT "volumes_ml_check" CHECK ("volumes"."ml" in (10, 30, 50)),
	CONSTRAINT "volumes_money_check" CHECK ("volumes"."price" >= 0 and ("volumes"."sale_price" is null or "volumes"."sale_price" >= 0) and "volumes"."on_hand" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fragrance_notes" ADD CONSTRAINT "fragrance_notes_fragrance_id_fragrances_id_fk" FOREIGN KEY ("fragrance_id") REFERENCES "public"."fragrances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fragrance_notes" ADD CONSTRAINT "fragrance_notes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fragrance_similar" ADD CONSTRAINT "fragrance_similar_fragrance_id_fragrances_id_fk" FOREIGN KEY ("fragrance_id") REFERENCES "public"."fragrances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fragrance_similar" ADD CONSTRAINT "fragrance_similar_similar_id_fragrances_id_fk" FOREIGN KEY ("similar_id") REFERENCES "public"."fragrances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fragrances" ADD CONSTRAINT "fragrances_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_fragrance_id_fragrances_id_fk" FOREIGN KEY ("fragrance_id") REFERENCES "public"."fragrances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fragrance_notes_pk" ON "fragrance_notes" USING btree ("fragrance_id","level","position");--> statement-breakpoint
CREATE UNIQUE INDEX "fragrance_similar_pk" ON "fragrance_similar" USING btree ("fragrance_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "volumes_fragrance_ml_idx" ON "volumes" USING btree ("fragrance_id","ml");