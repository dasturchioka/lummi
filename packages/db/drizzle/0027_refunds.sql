CREATE TABLE "refunds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refunds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"amount" integer NOT NULL,
	"refunded_on" date NOT NULL,
	"reason" text NOT NULL,
	"staff_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "refunds_day_idx" ON "refunds" USING btree ("refunded_on");