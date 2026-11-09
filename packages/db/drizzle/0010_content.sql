CREATE TABLE "content_texts" (
	"key" text PRIMARY KEY NOT NULL,
	"ru" text NOT NULL,
	"uz" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_banners" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "home_banners_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"image_hash" text,
	"title_ru" text NOT NULL,
	"title_uz" text NOT NULL,
	"subtitle_ru" text NOT NULL,
	"subtitle_uz" text NOT NULL,
	"price_line_ru" text,
	"price_line_uz" text,
	"target" text DEFAULT 'catalog' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "info_pages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "info_pages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"sort" smallint NOT NULL,
	"title_ru" text NOT NULL,
	"title_uz" text NOT NULL,
	"body_ru" text NOT NULL,
	"body_uz" text NOT NULL,
	"draft" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "info_pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "home_banners_one_active_idx" ON "home_banners" USING btree ("active") WHERE "home_banners"."active";