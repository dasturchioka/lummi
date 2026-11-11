CREATE TABLE "favourites" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "favourites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_id" bigint NOT NULL,
	"kind" text DEFAULT 'fragrance' NOT NULL,
	"fragrance_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favourites_target_check" CHECK (("favourites"."kind" = 'fragrance') = ("favourites"."fragrance_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_fragrance_id_fragrances_id_fk" FOREIGN KEY ("fragrance_id") REFERENCES "public"."fragrances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favourites_customer_fragrance_idx" ON "favourites" USING btree ("customer_id","fragrance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favourites_customer_set_idx" ON "favourites" USING btree ("customer_id") WHERE kind = 'discovery_set';