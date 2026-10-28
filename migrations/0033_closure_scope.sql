CREATE TYPE "public"."closure_scope" AS ENUM('school', 'sites', 'courses');--> statement-breakpoint
CREATE TABLE "closure_course" (
	"school_id" uuid NOT NULL,
	"closure_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	CONSTRAINT "closure_course_closure_id_course_id_pk" PRIMARY KEY("closure_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "closure_site" (
	"school_id" uuid NOT NULL,
	"closure_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	CONSTRAINT "closure_site_closure_id_site_id_pk" PRIMARY KEY("closure_id","site_id")
);
--> statement-breakpoint
-- Existing closures keep covering the whole school.
ALTER TABLE "closure" ADD COLUMN "scope" "closure_scope" DEFAULT 'school' NOT NULL;--> statement-breakpoint
-- Target of the composite foreign keys below: created before them.
ALTER TABLE "closure" ADD CONSTRAINT "closure_school_id_id_unique" UNIQUE("school_id","id");--> statement-breakpoint
ALTER TABLE "closure_course" ADD CONSTRAINT "closure_course_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_course" ADD CONSTRAINT "closure_course_closure_same_school_fk" FOREIGN KEY ("school_id","closure_id") REFERENCES "public"."closure"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_course" ADD CONSTRAINT "closure_course_course_same_school_fk" FOREIGN KEY ("school_id","course_id") REFERENCES "public"."course"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_site" ADD CONSTRAINT "closure_site_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_site" ADD CONSTRAINT "closure_site_closure_same_school_fk" FOREIGN KEY ("school_id","closure_id") REFERENCES "public"."closure"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_site" ADD CONSTRAINT "closure_site_site_same_school_fk" FOREIGN KEY ("school_id","site_id") REFERENCES "public"."site"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "closure_course_course_id_index" ON "closure_course" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "closure_site_site_id_index" ON "closure_site" USING btree ("site_id");--> statement-breakpoint
-- Multi-school isolation of the closure scope tables (model: 0001_rls.sql).
ALTER TABLE closure_site ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE closure_site FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON closure_site
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE closure_course ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE closure_course FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON closure_course
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- A site is only linked to a closure of scope « sites », a course to one of scope « courses ».
CREATE FUNCTION closure_link_matches_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  wanted closure_scope := CASE TG_TABLE_NAME WHEN 'closure_site' THEN 'sites' ELSE 'courses' END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM closure c WHERE c.id = NEW.closure_id AND c.scope = wanted) THEN
    RAISE EXCEPTION 'closure % does not have the scope %', NEW.closure_id, wanted USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER closure_site_scope BEFORE INSERT OR UPDATE ON closure_site
  FOR EACH ROW EXECUTE FUNCTION closure_link_matches_scope();--> statement-breakpoint
CREATE TRIGGER closure_course_scope BEFORE INSERT OR UPDATE ON closure_course
  FOR EACH ROW EXECUTE FUNCTION closure_link_matches_scope();--> statement-breakpoint
-- The scope of a closure is fixed once created: its links never contradict it.
CREATE FUNCTION closure_scope_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION 'the scope of closure % cannot change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER closure_scope_fixed BEFORE UPDATE OF scope ON closure
  FOR EACH ROW EXECUTE FUNCTION closure_scope_fixed();
