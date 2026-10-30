-- Invoice lines carry their invoice's billing entity (#318, ADR 0006). Three three-column
-- foreign keys tie each line to its invoice, its enrollment and its lesson pack within the
-- same entity, so the database refuses an invoice of one business billing a package or a
-- lesson pack sold by another.
--
-- Must run as a superuser or BYPASSRLS role (#279): invoice_line and invoice force Row Level
-- Security, so another owner would see no row and backfill nothing. No immutable table is
-- touched (no trigger is disabled).
DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Migration 0045 must run as a role that bypasses RLS (#279), not %', current_user;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "invoice_line" DROP CONSTRAINT "invoice_line_invoice_same_school_fk";--> statement-breakpoint
ALTER TABLE "invoice_line" DROP CONSTRAINT "invoice_line_enrollment_same_school_fk";--> statement-breakpoint
ALTER TABLE "invoice_line" DROP CONSTRAINT "invoice_line_lesson_pack_same_school_fk";--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
-- Each line takes its invoice's entity.
UPDATE "invoice_line" AS "x" SET "billing_entity_id" = "i"."billing_entity_id"
FROM "invoice" AS "i" WHERE "i"."school_id" = "x"."school_id" AND "i"."id" = "x"."invoice_id" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
-- A line billing an enrollment or a lesson pack of another entity than its invoice fails here:
-- such a line has to be corrected by hand before migrating, never moved silently.
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_same_entity_fk" FOREIGN KEY ("school_id","invoice_id","billing_entity_id") REFERENCES "public"."invoice"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_enrollment_same_entity_fk" FOREIGN KEY ("school_id","enrollment_id","billing_entity_id") REFERENCES "public"."enrollment"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_lesson_pack_same_entity_fk" FOREIGN KEY ("school_id","lesson_pack_id","billing_entity_id") REFERENCES "public"."lesson_pack"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Lookups by invoice, and the keys' checks when an enrollment or a lesson pack changes or is deleted.
CREATE INDEX "invoice_line_invoice_id_index" ON "invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_line_enrollment_id_index" ON "invoice_line" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "invoice_line_lesson_pack_id_index" ON "invoice_line" USING btree ("lesson_pack_id");
