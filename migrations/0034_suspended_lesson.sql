CREATE TABLE "suspended_lesson" (
	"school_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"reference_date" date NOT NULL,
	"date" date NOT NULL,
	"planned_date" date,
	"start_time" time,
	"duration_minutes" integer,
	"instructor_id" uuid,
	CONSTRAINT "suspended_lesson_course_id_reference_date_pk" PRIMARY KEY("course_id","reference_date")
);
--> statement-breakpoint
ALTER TABLE "suspended_lesson" ADD CONSTRAINT "suspended_lesson_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspended_lesson" ADD CONSTRAINT "suspended_lesson_course_same_school_fk" FOREIGN KEY ("school_id","course_id") REFERENCES "public"."course"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspended_lesson" ADD CONSTRAINT "suspended_lesson_instructor_same_school_fk" FOREIGN KEY ("school_id","instructor_id") REFERENCES "public"."instructor"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suspended_lesson_instructor_id_index" ON "suspended_lesson" USING btree ("instructor_id");--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE suspended_lesson ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE suspended_lesson FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON suspended_lesson
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
