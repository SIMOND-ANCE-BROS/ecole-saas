CREATE TABLE "lesson_pack_person" (
	"school_id" uuid NOT NULL,
	"lesson_pack_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "lesson_pack_person_lesson_pack_id_person_id_pk" PRIMARY KEY("lesson_pack_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "submission" DROP CONSTRAINT "submission_kind";--> statement-breakpoint
ALTER TABLE "lesson_pack_person" ADD CONSTRAINT "lesson_pack_person_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_pack_person" ADD CONSTRAINT "lesson_pack_person_lesson_pack_same_school_fk" FOREIGN KEY ("school_id","lesson_pack_id") REFERENCES "public"."lesson_pack"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_pack_person" ADD CONSTRAINT "lesson_pack_person_person_same_school_fk" FOREIGN KEY ("school_id","person_id") REFERENCES "public"."person"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_pack_person_person_id_index" ON "lesson_pack_person" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "lesson_pack" ADD CONSTRAINT "lesson_pack_price" CHECK ("lesson_pack"."price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_kind" CHECK ("submission"."kind" IN ('payment', 'enrollment', 'course', 'lesson_pack'));--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE lesson_pack_person ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE lesson_pack_person FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON lesson_pack_person
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
