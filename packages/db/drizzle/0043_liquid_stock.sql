CREATE TYPE "public"."consumable_unit" AS ENUM('pcs', 'ml');--> statement-breakpoint
CREATE TYPE "public"."consumable_use" AS ENUM('flacon', 'box', 'ethanol', 'other');--> statement-breakpoint
ALTER TYPE "public"."stock_move_kind" ADD VALUE 'mixing';--> statement-breakpoint
ALTER TYPE "public"."stock_move_kind" ADD VALUE 'set_assembly';--> statement-breakpoint
ALTER TYPE "public"."stock_move_kind" ADD VALUE 'consumable_received';--> statement-breakpoint
ALTER TYPE "public"."stock_move_kind" ADD VALUE 'consumable_corrected';--> statement-breakpoint
CREATE TABLE "consumables" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "consumables_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name_ru" text NOT NULL,
	"name_uz" text NOT NULL,
	"unit" "consumable_unit" NOT NULL,
	"use" "consumable_use" DEFAULT 'other' NOT NULL,
	"ml" smallint,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"low_threshold" integer DEFAULT 0 NOT NULL,
	"needs_recount" boolean DEFAULT false NOT NULL,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumables_counts_check" CHECK ("consumables"."on_hand" >= 0 and "consumables"."low_threshold" >= 0),
	CONSTRAINT "consumables_link_check" CHECK (("consumables"."use" = 'flacon' and "consumables"."ml" in (5, 10, 30, 50) and "consumables"."unit" = 'pcs')
        or ("consumables"."use" = 'box' and "consumables"."ml" in (10, 30, 50) and "consumables"."unit" = 'pcs')
        or ("consumables"."use" = 'ethanol' and "consumables"."ml" is null and "consumables"."unit" = 'ml')
        or ("consumables"."use" = 'other' and "consumables"."ml" is null))
);
--> statement-breakpoint
ALTER TABLE "volumes" DROP CONSTRAINT "volumes_money_check";--> statement-breakpoint
ALTER TABLE "stock_moves" ALTER COLUMN "fragrance_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fragrances" ADD COLUMN "concentrate_ul" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "concentrate_ul" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "consumables" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "consumables_use_ml_idx" ON "consumables" USING btree ("use",coalesce("ml", 0)) WHERE not "consumables"."archived" and "consumables"."use" <> 'other';--> statement-breakpoint
-- the seeded consumables (ADR 0043): a flacon of every ml, a box of every ml sold alone, the spirit
-- (counted by nobody yet: ours until a receipt or a count, like the 5 × 5 ml set's boxes)
INSERT INTO "consumables" ("name_ru", "name_uz", "unit", "use", "ml", "low_threshold", "is_placeholder") VALUES
  ('Флакон 5 мл', 'Flakon 5 ml', 'pcs', 'flacon', 5, 20, true),
  ('Флакон 10 мл', 'Flakon 10 ml', 'pcs', 'flacon', 10, 20, true),
  ('Флакон 30 мл', 'Flakon 30 ml', 'pcs', 'flacon', 30, 20, true),
  ('Флакон 50 мл', 'Flakon 50 ml', 'pcs', 'flacon', 50, 20, true),
  ('Коробка 10 мл', 'Quti 10 ml', 'pcs', 'box', 10, 20, true),
  ('Коробка 30 мл', 'Quti 30 ml', 'pcs', 'box', 30, 20, true),
  ('Коробка 50 мл', 'Quti 50 ml', 'pcs', 'box', 50, 20, true),
  ('Спирт', 'Spirt', 'ml', 'ethanol', NULL, 1000, true);--> statement-breakpoint
-- each fragrance's bottles on hand pour into its ready concentrate: a bottle is its fill, ml × (1 + the filling loss) in µl, at the stored loss (else its default, 3 %)
UPDATE "fragrances" f SET "concentrate_ul" = s."ul"
FROM (
  SELECT v."fragrance_id", sum(v."on_hand" * round(v."ml" * (1 + l."pct" / 100) * 1000))::bigint AS "ul"
  FROM "volumes" v,
    (SELECT coalesce((SELECT ("value" #>> '{}')::numeric FROM "settings" WHERE "key" = 'cost.liquid.fillingLossPercent'), 3) AS "pct") l
  WHERE v."on_hand" > 0
  GROUP BY v."fragrance_id"
) s
WHERE s."fragrance_id" = f."id";--> statement-breakpoint
-- a bottle on hand held a flacon and, at 10 / 30 / 50 ml, a box: they are in stock again; the count
-- stays ours where every bottle it came from was the seed's placeholder (`volumes.is_placeholder`)
UPDATE "consumables" c SET "on_hand" = s."n", "is_placeholder" = s."ours"
FROM (
  SELECT "ml", sum("on_hand")::int AS "n",
    coalesce(bool_and("is_placeholder") FILTER (WHERE "on_hand" > 0), true) AS "ours"
  FROM "volumes" GROUP BY "ml"
) s
WHERE c."ml" = s."ml" AND c."use" IN ('flacon', 'box');--> statement-breakpoint
-- one history line per fragrance: its bottles out, its concentrate, flacons and boxes in
INSERT INTO "stock_moves" ("fragrance_id", "kind", "concentrate_ul", "bottles", "consumables", "details", "actor_type")
SELECT f."id", 'correction', f."concentrate_ul",
  coalesce((SELECT jsonb_object_agg(v."ml"::text, -v."on_hand") FROM "volumes" v
    WHERE v."fragrance_id" = f."id" AND v."on_hand" > 0), '{}'::jsonb),
  coalesce((SELECT jsonb_object_agg(c."id"::text, v."on_hand") FROM "volumes" v
    JOIN "consumables" c ON c."ml" = v."ml" AND c."use" IN ('flacon', 'box')
    WHERE v."fragrance_id" = f."id" AND v."on_hand" > 0), '{}'::jsonb),
  '{"source": "migration"}'::jsonb, 'system'
FROM "fragrances" f
WHERE f."concentrate_ul" > 0
ORDER BY f."id";--> statement-breakpoint
-- the oil is read in ml now (`stock.lowOilMl`): the threshold in litres of perfume goes
DELETE FROM "settings" WHERE "key" = 'stock.lowOilLitres';--> statement-breakpoint
ALTER TABLE "volumes" DROP COLUMN "on_hand";--> statement-breakpoint
ALTER TABLE "fragrances" ADD CONSTRAINT "fragrances_concentrate_ul_check" CHECK ("fragrances"."concentrate_ul" >= 0);--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_subject_check" CHECK ("stock_moves"."fragrance_id" is not null or "stock_moves"."consumables" <> '{}'::jsonb);--> statement-breakpoint
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_money_check" CHECK ("volumes"."price" >= 0 and ("volumes"."sale_price" is null or "volumes"."sale_price" >= 0));