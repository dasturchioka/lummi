CREATE TYPE "public"."order_action" AS ENUM('submit_receipt', 'confirm_payment', 'reject_receipt', 'payment_not_found', 'accept', 'start_assembly', 'hand_to_bts', 'deliver', 'return', 'cancel');--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"from_status" "order_status" NOT NULL,
	"to_status" "order_status" NOT NULL,
	"action" "order_action" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" bigint,
	"reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "reserve_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "orders_awaiting_reserve_idx" ON "orders" USING btree ("reserve_until") WHERE "orders"."status" = 'awaiting_payment';