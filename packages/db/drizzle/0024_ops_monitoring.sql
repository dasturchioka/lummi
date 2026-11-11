CREATE TABLE "error_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "error_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"fingerprint" text NOT NULL,
	"error_class" text NOT NULL,
	"route" text NOT NULL,
	"frames" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeat" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"outage_alerted_at" timestamp with time zone,
	CONSTRAINT "worker_heartbeat_one_row" CHECK ("worker_heartbeat"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "error_events_fingerprint_key" ON "error_events" USING btree ("fingerprint");