CREATE TYPE "public"."outbox_kind" AS ENUM('message', 'order_card');--> statement-breakpoint
CREATE TABLE "order_card_prompts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_card_prompts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"staff_id" bigint NOT NULL,
	"expected_status" "order_status" NOT NULL,
	"outbox_id" bigint NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_card_prompts_outbox_id_unique" UNIQUE("outbox_id")
);
--> statement-breakpoint
CREATE TABLE "order_cards" (
	"order_id" bigint PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"thread_id" integer,
	"message_id" bigint,
	"receipt_id" bigint,
	"receipt_posted_at" timestamp with time zone,
	"panel" jsonb DEFAULT '{"kind":"steps"}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"shown_hash" text,
	"syncing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "kind" "outbox_kind" DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "ref" bigint;--> statement-breakpoint
ALTER TABLE "order_card_prompts" ADD CONSTRAINT "order_card_prompts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_card_prompts" ADD CONSTRAINT "order_card_prompts_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_card_prompts" ADD CONSTRAINT "order_card_prompts_outbox_id_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_cards" ADD CONSTRAINT "order_cards_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_cards" ADD CONSTRAINT "order_cards_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_card_prompts_order_idx" ON "order_card_prompts" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_task_ref" CHECK (("outbox"."kind" = 'message') = ("outbox"."ref" is null));