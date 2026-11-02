CREATE TABLE "workshop_signup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"billing_entity_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"payer_id" uuid NOT NULL,
	"vat_treatment_id" uuid NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"price_reason" text,
	"signed_up_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workshop_signup_school_id_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "workshop_signup_school_id_id_billing_entity_id_unique" UNIQUE("school_id","id","billing_entity_id"),
	CONSTRAINT "workshop_signup_price" CHECK ("workshop_signup"."unit_price_cents" >= 0),
	CONSTRAINT "workshop_signup_reason" CHECK ("workshop_signup"."price_reason" IS NULL OR btrim("workshop_signup"."price_reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "workshop_signup_person" (
	"school_id" uuid NOT NULL,
	"workshop_signup_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "workshop_signup_person_workshop_signup_id_person_id_pk" PRIMARY KEY("workshop_signup_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "submission" DROP CONSTRAINT "submission_kind";--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "workshop_price_cents" integer;--> statement-breakpoint
ALTER TABLE "workshop_signup" ADD CONSTRAINT "workshop_signup_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_signup" ADD CONSTRAINT "workshop_signup_billing_entity_same_school_fk" FOREIGN KEY ("school_id","billing_entity_id") REFERENCES "public"."billing_entity"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_signup" ADD CONSTRAINT "workshop_signup_course_same_entity_fk" FOREIGN KEY ("school_id","course_id","billing_entity_id") REFERENCES "public"."course"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_signup" ADD CONSTRAINT "workshop_signup_payer_same_school_fk" FOREIGN KEY ("school_id","payer_id") REFERENCES "public"."person"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_signup" ADD CONSTRAINT "workshop_signup_vat_treatment_same_school_fk" FOREIGN KEY ("school_id","vat_treatment_id") REFERENCES "public"."vat_treatment"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_signup_person" ADD CONSTRAINT "workshop_signup_person_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_signup_person" ADD CONSTRAINT "workshop_signup_person_workshop_signup_same_school_fk" FOREIGN KEY ("school_id","workshop_signup_id") REFERENCES "public"."workshop_signup"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_signup_person" ADD CONSTRAINT "workshop_signup_person_person_same_school_fk" FOREIGN KEY ("school_id","person_id") REFERENCES "public"."person"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workshop_signup_payer_id_index" ON "workshop_signup" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX "workshop_signup_course_id_index" ON "workshop_signup" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "workshop_signup_person_person_id_index" ON "workshop_signup_person" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_workshop_price" CHECK ("course"."workshop_price_cents" IS NULL OR ("course"."type" = 'workshop' AND "course"."workshop_price_cents" >= 0));--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_kind" CHECK ("submission"."kind" IN ('payment', 'enrollment', 'course', 'lesson_pack', 'workshop_signup'));--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE workshop_signup ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workshop_signup FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON workshop_signup
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE workshop_signup_person ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workshop_signup_person FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON workshop_signup_person
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
