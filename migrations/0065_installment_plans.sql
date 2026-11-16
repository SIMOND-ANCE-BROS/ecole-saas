CREATE TABLE "installment_plan_setting" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"counts" smallint[] NOT NULL,
	"due_day" smallint NOT NULL,
	"rounding_unit_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plan_setting_counts" CHECK (cardinality("installment_plan_setting"."counts") BETWEEN 1 AND 12 AND array_position("installment_plan_setting"."counts", NULL) IS NULL AND 1 <= ALL("installment_plan_setting"."counts") AND 12 >= ALL("installment_plan_setting"."counts")),
	CONSTRAINT "installment_plan_setting_due_day" CHECK ("installment_plan_setting"."due_day" BETWEEN 1 AND 28),
	CONSTRAINT "installment_plan_setting_rounding" CHECK ("installment_plan_setting"."rounding_unit_cents" IN (1, 100))
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "installment_count" smallint;--> statement-breakpoint
ALTER TABLE "installment_plan_setting" ADD CONSTRAINT "installment_plan_setting_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_installment_count" CHECK ("invoice"."installment_count" BETWEEN 1 AND 12);--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE installment_plan_setting ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE installment_plan_setting FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON installment_plan_setting
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
