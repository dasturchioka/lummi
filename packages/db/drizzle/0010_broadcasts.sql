CREATE TYPE "public"."broadcast_audience" AS ENUM('all', 'ru', 'uz');--> statement-breakpoint
CREATE TYPE "public"."broadcast_delivery_status" AS ENUM('pending', 'sent', 'blocked', 'failed');--> statement-breakpoint
CREATE TABLE "broadcast_deliveries" (
	"broadcast_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"status" "broadcast_delivery_status" DEFAULT 'pending' NOT NULL,
	"queued_at" timestamp with time zone,
	"sending_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "broadcast_deliveries_broadcast_id_customer_id_pk" PRIMARY KEY("broadcast_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "broadcasts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"audience" "broadcast_audience" NOT NULL,
	"text_ru" text NOT NULL,
	"text_uz" text NOT NULL,
	"image_key" text,
	"button_target" text,
	"photo_file_id" text,
	"created_by" bigint,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_deliveries_pending_idx" ON "broadcast_deliveries" USING btree ("broadcast_id") WHERE status = 'pending';