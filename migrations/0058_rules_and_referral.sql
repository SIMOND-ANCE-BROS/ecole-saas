CREATE TABLE "internal_rules_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_rules_version_school_id_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "internal_rules_version_school_id_id_season_id_unique" UNIQUE("school_id","id","season_id"),
	CONSTRAINT "internal_rules_version_text" CHECK (char_length(btrim("internal_rules_version"."text")) BETWEEN 1 AND 50000)
);
--> statement-breakpoint
CREATE TABLE "referral_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "referral_source_school_id_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "referral_source_label" CHECK (char_length(btrim("referral_source"."label")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "rules_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"payer_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"rules_version_id" uuid,
	"accepted_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_acceptance_payer_id_season_id_unique" UNIQUE("payer_id","season_id")
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "refuses_photos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "referral_source_id" uuid;--> statement-breakpoint
ALTER TABLE "internal_rules_version" ADD CONSTRAINT "internal_rules_version_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_rules_version" ADD CONSTRAINT "internal_rules_version_season_same_school_fk" FOREIGN KEY ("school_id","season_id") REFERENCES "public"."season"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_source" ADD CONSTRAINT "referral_source_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_acceptance" ADD CONSTRAINT "rules_acceptance_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_acceptance" ADD CONSTRAINT "rules_acceptance_payer_same_school_fk" FOREIGN KEY ("school_id","payer_id") REFERENCES "public"."person"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_acceptance" ADD CONSTRAINT "rules_acceptance_season_same_school_fk" FOREIGN KEY ("school_id","season_id") REFERENCES "public"."season"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules_acceptance" ADD CONSTRAINT "rules_acceptance_rules_version_same_season_fk" FOREIGN KEY ("school_id","rules_version_id","season_id") REFERENCES "public"."internal_rules_version"("school_id","id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_rules_version_season_id_created_at_index" ON "internal_rules_version" USING btree ("season_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_source_label_unique" ON "referral_source" USING btree ("school_id",lower("label"));--> statement-breakpoint
CREATE INDEX "rules_acceptance_season_id_index" ON "rules_acceptance" USING btree ("season_id");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_referral_source_same_school_fk" FOREIGN KEY ("school_id","referral_source_id") REFERENCES "public"."referral_source"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_referral_source_id_index" ON "person" USING btree ("referral_source_id");--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE internal_rules_version ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE internal_rules_version FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON internal_rules_version
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE referral_source ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE referral_source FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON referral_source
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE rules_acceptance ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE rules_acceptance FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON rules_acceptance
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- A version of the rules is what payers accepted (#296): never rewritten. Another text is a new
-- version; deleting stays possible only where no acceptance points to it (foreign key).
CREATE FUNCTION internal_rules_version_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'internal_rules_version is never updated: save a new version';
END $$;--> statement-breakpoint
CREATE TRIGGER internal_rules_version_frozen BEFORE UPDATE ON internal_rules_version
  FOR EACH ROW EXECUTE FUNCTION internal_rules_version_frozen();
