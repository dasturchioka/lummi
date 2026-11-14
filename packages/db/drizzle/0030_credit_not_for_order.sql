ALTER TABLE "credits" ADD COLUMN "not_for_order_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "not_for_order_by" bigint;--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "not_for_order_note" text;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_not_for_order" CHECK (("credits"."not_for_order_at" is null) = ("credits"."not_for_order_by" is null) and ("credits"."not_for_order_note" is null or "credits"."not_for_order_at" is not null));