CREATE TYPE "public"."receipt_check_outcome" AS ENUM('confirmed', 'manual_review', 'credit_taken', 'stale');--> statement-breakpoint
CREATE TYPE "public"."receipt_review_reason" AS ENUM('duplicate', 'not_confirmed', 'judge_failed');--> statement-breakpoint
CREATE TABLE "receipt_checks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipt_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_id" bigint NOT NULL,
	"candidate_credit_ids" bigint[] NOT NULL,
	"judgement" jsonb NOT NULL,
	"outcome" "receipt_check_outcome",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_checks_candidates" CHECK (cardinality("receipt_checks"."candidate_credit_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "credit_id" bigint;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "review_reason" "receipt_review_reason";--> statement-breakpoint
ALTER TABLE "receipt_checks" ADD CONSTRAINT "receipt_checks_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_checks_receipt_idx" ON "receipt_checks" USING btree ("receipt_id","id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_credit_id_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."credits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_credit_idx" ON "orders" USING btree ("credit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_one_accepted_idx" ON "receipts" USING btree ("order_id") WHERE "receipts"."verdict" in ('ai_confirmed', 'manager_confirmed');