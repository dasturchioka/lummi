ALTER TYPE "public"."outbox_kind" ADD VALUE 'manual_review_post';--> statement-breakpoint
CREATE TABLE "manual_review_posts" (
	"receipt_id" bigint PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"chat_id" bigint NOT NULL,
	"thread_id" integer,
	"message_id" bigint,
	"receipt_posted_at" timestamp with time zone,
	"panel" jsonb DEFAULT '{"kind":"choices"}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"shown_hash" text,
	"syncing_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manual_review_posts" ADD CONSTRAINT "manual_review_posts_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_posts" ADD CONSTRAINT "manual_review_posts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_review_posts_order_idx" ON "manual_review_posts" USING btree ("order_id");