-- VAT treatment of each course and lesson pack (#301, ADR 0006): a rate, an exemption or out
-- of scope (EN 16931 S, E, O), with the mention printed on invoice lines without VAT. Copied
-- onto each invoice line when drafted; prices are VAT-inclusive and the line's incl. amount is
-- the source of truth (excl. + VAT = incl.).
--
-- Must run as a superuser or BYPASSRLS role (#279): every table touched forces Row Level
-- Security, so another owner would see no school and backfill nothing. No immutable table is
-- touched (no trigger is disabled).
DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Migration 0049 must run as a role that bypasses RLS (#279), not %', current_user;
  END IF;
END $$;--> statement-breakpoint
CREATE TYPE "public"."vat_category" AS ENUM('standard', 'exempt', 'not_subject');--> statement-breakpoint
CREATE TABLE "vat_treatment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"label" text NOT NULL,
	"category" "vat_category" NOT NULL,
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"mention" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_treatment_school_id_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "vat_treatment_label_unique" UNIQUE("school_id","label"),
	CONSTRAINT "vat_treatment_rate" CHECK ("vat_treatment"."rate_bps" BETWEEN 0 AND 10000 AND ("vat_treatment"."category" = 'standard') = ("vat_treatment"."rate_bps" > 0)),
	CONSTRAINT "vat_treatment_mention" CHECK ("vat_treatment"."category" = 'standard' OR coalesce(btrim("vat_treatment"."mention"), '') <> '')
);
--> statement-breakpoint
ALTER TABLE "vat_treatment" ADD CONSTRAINT "vat_treatment_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE vat_treatment ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE vat_treatment FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON vat_treatment
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- One treatment per existing school: lessons are exempt (CGI art. 261, 4, 4° b, #289), the
-- owner-approved default of #301 Q1. Label and mention are data, editable in « Paramètres ›
-- TVA » once the accountant has worded them; an exemption suits every VAT regime, so no
-- business is left with a treatment its regime refuses. New schools get theirs explicitly
-- (scripts/seed.ts, test fixtures): no trigger on school.
INSERT INTO "vat_treatment" ("school_id", "label", "category", "mention")
SELECT "id", 'Exonéré (art. 261-4-4° b)', 'exempt', 'Exonération de TVA, article 261, 4, 4° b du CGI'
FROM "school";--> statement-breakpoint
-- Every business of the school proposes it by default.
ALTER TABLE "billing_entity" ADD COLUMN "default_vat_treatment_id" uuid;--> statement-breakpoint
UPDATE "billing_entity" AS "e" SET "default_vat_treatment_id" = "t"."id"
FROM "vat_treatment" AS "t" WHERE "t"."school_id" = "e"."school_id";--> statement-breakpoint
-- Every existing course and lesson pack takes its business's default treatment.
ALTER TABLE "course" ADD COLUMN "vat_treatment_id" uuid;--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_pack" ADD COLUMN "vat_treatment_id" uuid;--> statement-breakpoint
UPDATE "course" AS "x" SET "vat_treatment_id" = "e"."default_vat_treatment_id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."id" = "x"."billing_entity_id";--> statement-breakpoint
UPDATE "lesson_pack" AS "x" SET "vat_treatment_id" = "e"."default_vat_treatment_id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."id" = "x"."billing_entity_id";--> statement-breakpoint
ALTER TABLE "course" ALTER COLUMN "vat_treatment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_pack" ALTER COLUMN "vat_treatment_id" SET NOT NULL;--> statement-breakpoint
-- Invoice lines: the incl. amount from the unit price and quantity, VAT taken out of it at the
-- line's rate, half a cent away from zero (numeric round), as vatOfInclusive does.
ALTER TABLE "invoice_line" ADD COLUMN "incl_tax_cents" integer;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "excl_tax_cents" integer;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "vat_cents" integer;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "vat_treatment_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "vat_category" "vat_category";--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "vat_mention" text;--> statement-breakpoint
UPDATE "invoice_line" SET "incl_tax_cents" = round("unit_price_cents"::numeric * "quantity_thousandths" / 1000);--> statement-breakpoint
UPDATE "invoice_line" SET
  "vat_cents" = round("incl_tax_cents"::numeric * "vat_rate_bps" / (10000 + "vat_rate_bps")),
  "vat_category" = CASE WHEN "vat_rate_bps" > 0 THEN 'standard' ELSE 'exempt' END::"vat_category";--> statement-breakpoint
UPDATE "invoice_line" SET "excl_tax_cents" = "incl_tax_cents" - "vat_cents";--> statement-breakpoint
-- A line without VAT takes the school's treatment and its mention. A line with a VAT rate has
-- no matching treatment yet and fails on NOT NULL below: no invoice line is written by the
-- application before #301, so none is expected; one would have to be corrected by hand.
UPDATE "invoice_line" AS "x" SET "vat_treatment_id" = "t"."id", "vat_mention" = "t"."mention"
FROM "vat_treatment" AS "t" WHERE "t"."school_id" = "x"."school_id" AND "x"."vat_rate_bps" = 0;--> statement-breakpoint
ALTER TABLE "invoice_line" ALTER COLUMN "incl_tax_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ALTER COLUMN "excl_tax_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ALTER COLUMN "vat_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ALTER COLUMN "vat_treatment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ALTER COLUMN "vat_category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_entity" ADD CONSTRAINT "billing_entity_default_vat_treatment_same_school_fk" FOREIGN KEY ("school_id","default_vat_treatment_id") REFERENCES "public"."vat_treatment"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_vat_treatment_same_school_fk" FOREIGN KEY ("school_id","vat_treatment_id") REFERENCES "public"."vat_treatment"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_vat_treatment_same_school_fk" FOREIGN KEY ("school_id","vat_treatment_id") REFERENCES "public"."vat_treatment"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_pack" ADD CONSTRAINT "lesson_pack_vat_treatment_same_school_fk" FOREIGN KEY ("school_id","vat_treatment_id") REFERENCES "public"."vat_treatment"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The foreign key's check when a treatment is removed, and the lines of a treatment.
CREATE INDEX "invoice_line_vat_treatment_id_index" ON "invoice_line" USING btree ("vat_treatment_id");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_vat_sum" CHECK ("invoice_line"."excl_tax_cents" + "invoice_line"."vat_cents" = "invoice_line"."incl_tax_cents");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_vat_rate" CHECK ("invoice_line"."vat_rate_bps" BETWEEN 0 AND 10000 AND ("invoice_line"."vat_category" = 'standard') = ("invoice_line"."vat_rate_bps" > 0));--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_vat_mention" CHECK ("invoice_line"."vat_category" = 'standard' OR ("invoice_line"."vat_cents" = 0 AND coalesce(btrim("invoice_line"."vat_mention"), '') <> ''));--> statement-breakpoint
-- A course or lesson pack inserted without a treatment takes its business's default (#301:
-- « lesson_pack.vat_treatment_id defaulting to the entity's default »). The application always
-- names one; a business without a default still fails on NOT NULL. Runs as the inserting role,
-- under its Row Level Security: it only ever reads the row's own business.
CREATE FUNCTION vat_treatment_from_entity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.vat_treatment_id IS NULL THEN
    SELECT default_vat_treatment_id INTO NEW.vat_treatment_id
    FROM billing_entity WHERE school_id = NEW.school_id AND id = NEW.billing_entity_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER course_vat_treatment_default BEFORE INSERT ON course
  FOR EACH ROW EXECUTE FUNCTION vat_treatment_from_entity();--> statement-breakpoint
CREATE TRIGGER lesson_pack_vat_treatment_default BEFORE INSERT ON lesson_pack
  FOR EACH ROW EXECUTE FUNCTION vat_treatment_from_entity();
