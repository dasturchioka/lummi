CREATE TABLE "credits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"humo_message_id" bigint NOT NULL,
	"amount_tiyin" bigint NOT NULL,
	"amount_som" bigint GENERATED ALWAYS AS (case when amount_tiyin % 100 = 0 then amount_tiyin / 100 end) STORED,
	"occurred_at" timestamp with time zone NOT NULL,
	"card_mask" text NOT NULL,
	"card_last4" text NOT NULL,
	"counterparty" text,
	CONSTRAINT "credits_humo_message_id_unique" UNIQUE("humo_message_id"),
	CONSTRAINT "credits_amount_positive" CHECK ("credits"."amount_tiyin" > 0),
	CONSTRAINT "credits_card_last4" CHECK ("credits"."card_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"component" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "humo_messages" (
	"message_id" bigint PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"parse_error" text
);
--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_humo_message_id_humo_messages_message_id_fk" FOREIGN KEY ("humo_message_id") REFERENCES "public"."humo_messages"("message_id") ON DELETE no action ON UPDATE no action;