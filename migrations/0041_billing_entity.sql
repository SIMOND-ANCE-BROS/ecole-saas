-- Billing entities (#298, ADR 0006): a school invoices, cashes and deposits through one or
-- more businesses, exactly one by default. The entity is not a tenant: RLS stays per school,
-- and composite foreign keys carrying billing_entity_id keep each invoice, installment,
-- payment, allocation and deposit inside one entity.
--
-- Must run as a superuser or BYPASSRLS role (#279): school and every business table force
-- Row Level Security, so another owner would see no school, create no default entity and
-- backfill nothing. Checked first, so the migration fails instead of doing half its work.
DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Migration 0041 must run as a role that bypasses RLS (#279), not %', current_user;
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE "billing_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text NOT NULL,
	"siren" char(9),
	"siret" char(14),
	"vat_number" text,
	"address_line" text,
	"postal_code" text,
	"city" text,
	"vat_regime" "vat_regime" NOT NULL,
	"vat_mention" text,
	"bank_account_label" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_entity_school_id_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "billing_entity_name_unique" UNIQUE("school_id","name"),
	CONSTRAINT "billing_entity_siren" CHECK ("billing_entity"."siren" ~ '^[0-9]{9}$'),
	CONSTRAINT "billing_entity_siret" CHECK ("billing_entity"."siret" ~ '^[0-9]{14}$' AND left("billing_entity"."siret", 9) = "billing_entity"."siren"),
	CONSTRAINT "billing_entity_default_active" CHECK ("billing_entity"."active" OR NOT "billing_entity"."is_default")
);
--> statement-breakpoint
ALTER TABLE "billing_entity" ADD CONSTRAINT "billing_entity_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_entity_one_default" ON "billing_entity" USING btree ("school_id") WHERE "billing_entity"."is_default";--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE billing_entity ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE billing_entity FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON billing_entity
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- One default entity per existing school, from what the school carried until now. Its
-- columns are dropped by 0042 once nothing reads them. New schools get theirs explicitly
-- (scripts/seed.ts, test fixtures): no trigger on school. school.siren had no format check:
-- a value that is not 9 digits is left out (to retype in « Paramètres › Entreprises ») rather
-- than failing the migration on the new check.
INSERT INTO "billing_entity" ("school_id", "name", "legal_name", "siren", "vat_regime", "vat_mention", "is_default")
SELECT "id", "name", coalesce("company_name", "name"), CASE WHEN "siren" ~ '^[0-9]{9}$' THEN "siren" END,
  "vat_regime", "vat_mention", true
FROM "school";--> statement-breakpoint
-- Invoicing connector: one tool account per entity instead of per school.
ALTER TABLE "invoicing_connector" DROP CONSTRAINT "invoicing_connector_pkey";--> statement-breakpoint
ALTER TABLE "invoicing_connector" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
UPDATE "invoicing_connector" AS "c" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "c"."school_id" AND "e"."is_default";--> statement-breakpoint
ALTER TABLE "invoicing_connector" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoicing_connector" ADD CONSTRAINT "invoicing_connector_pkey" PRIMARY KEY ("billing_entity_id");--> statement-breakpoint
-- The issuer of every existing invoice, installment, payment, allocation and deposit is its
-- school's default entity.
ALTER TABLE "invoice" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "installment" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_deposit" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_deposit_payment" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
UPDATE "invoice" AS "x" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."is_default" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
UPDATE "installment" AS "x" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."is_default" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
-- Payments are immutable: the trigger "payment_immutable" refuses any UPDATE. Disabling it
-- here, for this one statement inside the migration's transaction, is the only exception
-- (#298, precedent 0037, checked by migration-reviewer); it is enabled again right after, in
-- the same migration. The statement only fills the new column: no amount, date, method,
-- reference or link of a payment changes.
ALTER TABLE "payment" DISABLE TRIGGER "payment_immutable";--> statement-breakpoint
UPDATE "payment" AS "x" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."is_default" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
ALTER TABLE "payment" ENABLE TRIGGER "payment_immutable";--> statement-breakpoint
UPDATE "payment_allocation" AS "x" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."is_default" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
UPDATE "bank_deposit" AS "x" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."is_default" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
UPDATE "bank_deposit_payment" AS "x" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."is_default" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
-- A row left without its entity (it should not happen: every school got one) fails here.
ALTER TABLE "invoice" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "installment" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocation" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_deposit" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_deposit_payment" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
-- Two-column keys replaced by three-column keys carrying the entity.
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_school_id_number_unique";--> statement-breakpoint
ALTER TABLE "bank_deposit_payment" DROP CONSTRAINT "bank_deposit_payment_bank_deposit_same_school_fk";--> statement-breakpoint
ALTER TABLE "bank_deposit_payment" DROP CONSTRAINT "bank_deposit_payment_payment_same_school_fk";--> statement-breakpoint
ALTER TABLE "installment" DROP CONSTRAINT "installment_invoice_same_school_fk";--> statement-breakpoint
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_credit_note_of_same_school_fk";--> statement-breakpoint
ALTER TABLE "payment" DROP CONSTRAINT "payment_corrects_same_school_fk";--> statement-breakpoint
ALTER TABLE "payment_allocation" DROP CONSTRAINT "payment_allocation_payment_same_school_fk";--> statement-breakpoint
ALTER TABLE "payment_allocation" DROP CONSTRAINT "payment_allocation_installment_same_school_fk";--> statement-breakpoint
-- Targets of the three-column keys first, then the keys.
ALTER TABLE "bank_deposit" ADD CONSTRAINT "bank_deposit_school_id_id_billing_entity_id_unique" UNIQUE("school_id","id","billing_entity_id");--> statement-breakpoint
ALTER TABLE "installment" ADD CONSTRAINT "installment_school_id_id_billing_entity_id_unique" UNIQUE("school_id","id","billing_entity_id");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_billing_entity_id_number_unique" UNIQUE("billing_entity_id","number");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_school_id_id_billing_entity_id_unique" UNIQUE("school_id","id","billing_entity_id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_school_id_id_billing_entity_id_unique" UNIQUE("school_id","id","billing_entity_id");--> statement-breakpoint
ALTER TABLE "bank_deposit" ADD CONSTRAINT "bank_deposit_billing_entity_same_school_fk" FOREIGN KEY ("school_id","billing_entity_id") REFERENCES "public"."billing_entity"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_deposit_payment" ADD CONSTRAINT "bank_deposit_payment_bank_deposit_same_entity_fk" FOREIGN KEY ("school_id","bank_deposit_id","billing_entity_id") REFERENCES "public"."bank_deposit"("school_id","id","billing_entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_deposit_payment" ADD CONSTRAINT "bank_deposit_payment_payment_same_entity_fk" FOREIGN KEY ("school_id","payment_id","billing_entity_id") REFERENCES "public"."payment"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment" ADD CONSTRAINT "installment_invoice_same_entity_fk" FOREIGN KEY ("school_id","invoice_id","billing_entity_id") REFERENCES "public"."invoice"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_billing_entity_same_school_fk" FOREIGN KEY ("school_id","billing_entity_id") REFERENCES "public"."billing_entity"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_credit_note_of_same_entity_fk" FOREIGN KEY ("school_id","credit_note_of","billing_entity_id") REFERENCES "public"."invoice"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoicing_connector" ADD CONSTRAINT "invoicing_connector_billing_entity_same_school_fk" FOREIGN KEY ("school_id","billing_entity_id") REFERENCES "public"."billing_entity"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_billing_entity_same_school_fk" FOREIGN KEY ("school_id","billing_entity_id") REFERENCES "public"."billing_entity"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_corrects_same_entity_fk" FOREIGN KEY ("school_id","corrects_id","billing_entity_id") REFERENCES "public"."payment"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_same_entity_fk" FOREIGN KEY ("school_id","payment_id","billing_entity_id") REFERENCES "public"."payment"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_installment_same_entity_fk" FOREIGN KEY ("school_id","installment_id","billing_entity_id") REFERENCES "public"."installment"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;
