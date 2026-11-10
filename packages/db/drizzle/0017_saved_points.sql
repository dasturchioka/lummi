CREATE TABLE "saved_points" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "saved_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_id" bigint NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"bts_point_id" bigint NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_points" ADD CONSTRAINT "saved_points_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_points" ADD CONSTRAINT "saved_points_bts_point_id_bts_points_id_fk" FOREIGN KEY ("bts_point_id") REFERENCES "public"."bts_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_points_customer_pair_idx" ON "saved_points" USING btree ("customer_id","recipient_phone","bts_point_id");--> statement-breakpoint
CREATE INDEX "saved_points_customer_used_idx" ON "saved_points" USING btree ("customer_id","last_used_at");