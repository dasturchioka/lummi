DROP INDEX "promo_banners_one_active_idx";--> statement-breakpoint
ALTER TABLE "promo_banners" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;