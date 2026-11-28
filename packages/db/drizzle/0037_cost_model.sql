CREATE TYPE "public"."fragrance_tier" AS ENUM('top', 'premium', 'premium_new');--> statement-breakpoint
ALTER TABLE "fragrances" ADD COLUMN "oil_price" integer;--> statement-breakpoint
ALTER TABLE "fragrances" ADD COLUMN "tier" "fragrance_tier";--> statement-breakpoint
ALTER TABLE "fragrances" ADD COLUMN "oil_supplier" text;--> statement-breakpoint
ALTER TABLE "fragrances" ADD COLUMN "oil_invoice" text;--> statement-breakpoint
ALTER TABLE "fragrances" ADD CONSTRAINT "fragrances_oil_price_check" CHECK ("fragrances"."oil_price" is null or "fragrances"."oil_price" > 0);