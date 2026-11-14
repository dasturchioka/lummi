CREATE TYPE "public"."login_throttle_scope" AS ENUM('login', 'ip');--> statement-breakpoint
CREATE TABLE "login_throttles" (
	"scope" "login_throttle_scope" NOT NULL,
	"key" text NOT NULL,
	"failures" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "login_throttles_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "staff_telegram_links" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_telegram_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"staff_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_telegram_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "telegram_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "login" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_telegram_links" ADD CONSTRAINT "staff_telegram_links_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_telegram_links_staff_idx" ON "staff_telegram_links" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_login_unique" UNIQUE("login");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_login_format" CHECK ("staff"."login" ~ '^[a-z0-9._-]{3,32}$');--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_password_needs_login" CHECK ("staff"."password_hash" is null or "staff"."login" is not null);--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_has_way_in" CHECK ("staff"."telegram_id" is not null or "staff"."login" is not null);