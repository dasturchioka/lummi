CREATE TYPE "public"."payment_pause_cause" AS ENUM('heartbeat', 'silence');--> statement-breakpoint
CREATE TABLE "payment_pauses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_pauses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"cause" "payment_pause_cause" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "payment_pauses_ends_after_start" CHECK ("payment_pauses"."ended_at" >= "payment_pauses"."started_at")
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "duplicate_of" bigint;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "unchecked_alert_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_pauses_one_open_idx" ON "payment_pauses" USING btree (("ended_at" is null)) WHERE "payment_pauses"."ended_at" is null;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_duplicate_of_receipts_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;