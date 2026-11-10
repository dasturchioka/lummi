ALTER TABLE "orders" ADD COLUMN "credit_id" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_credit_id_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."credits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_credit_idx" ON "orders" USING btree ("credit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_one_accepted_idx" ON "receipts" USING btree ("order_id") WHERE "receipts"."verdict" in ('ai_confirmed', 'manager_confirmed');