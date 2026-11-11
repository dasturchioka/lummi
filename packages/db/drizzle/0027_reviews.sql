ALTER TYPE "public"."outbox_kind" ADD VALUE 'review_post';--> statement-breakpoint
CREATE TABLE "review_photos" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_photos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"review_id" bigint NOT NULL,
	"file_id" text NOT NULL,
	"file_key" text,
	"public_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"step" text DEFAULT 'comment' NOT NULL,
	"step_at" timestamp with time zone DEFAULT now() NOT NULL,
	"post_queued_at" timestamp with time zone,
	"topic_queued_at" timestamp with time zone,
	"topic_posted_at" timestamp with time zone,
	"topic_message_id" bigint,
	"follow_up_posted_at" timestamp with time zone,
	"post_lease_at" timestamp with time zone,
	"photo_limit_notice_at" timestamp with time zone,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "review_request" text;--> statement-breakpoint
ALTER TABLE "review_photos" ADD CONSTRAINT "review_photos_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_photos_review_idx" ON "review_photos" USING btree ("review_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_photos_public_key_idx" ON "review_photos" USING btree ("public_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_idx" ON "reviews" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reviews_created_idx" ON "reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reviews_published_idx" ON "reviews" USING btree ("published_at") WHERE "reviews"."published";--> statement-breakpoint
CREATE INDEX "orders_review_due_idx" ON "orders" USING btree ("id") WHERE "orders"."status" = 'delivered' and "orders"."review_requested_at" is null;