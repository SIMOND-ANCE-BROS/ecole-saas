ALTER TYPE "public"."payment_method" ADD VALUE 'holiday_voucher_online' BEFORE 'pass_sport';--> statement-breakpoint
CREATE TABLE "payment_method_setting" (
	"school_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"accepted" boolean NOT NULL,
	"desk_hint" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_method_setting_school_id_method_pk" PRIMARY KEY("school_id","method"),
	CONSTRAINT "payment_method_setting_hint" CHECK (char_length("payment_method_setting"."desk_hint") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "payment_method_setting" ADD CONSTRAINT "payment_method_setting_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE payment_method_setting ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE payment_method_setting FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON payment_method_setting
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
