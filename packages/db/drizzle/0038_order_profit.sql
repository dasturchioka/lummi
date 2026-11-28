ALTER TABLE "order_lines" ADD COLUMN "unit_cost" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "costs" jsonb;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_unit_cost_check" CHECK ("order_lines"."unit_cost" is null or "order_lines"."unit_cost" >= 0);