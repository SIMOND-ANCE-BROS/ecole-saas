-- Courses, enrollments and lesson packs carry the business that sells them (#299, ADR 0006).
-- An enrollment never spans two entities: each enrollment_course row carries the
-- enrollment's entity, and two three-column foreign keys tie it to both the enrollment and
-- the course, so the database refuses a package mixing two businesses.
--
-- Must run as a superuser or BYPASSRLS role (#279): every table touched forces Row Level
-- Security, so another owner would see no row and backfill nothing. No immutable table is
-- touched (no trigger is disabled).
DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Migration 0044 must run as a role that bypasses RLS (#279), not %', current_user;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "enrollment_course" DROP CONSTRAINT "enrollment_course_enrollment_same_school_fk";--> statement-breakpoint
ALTER TABLE "enrollment_course" DROP CONSTRAINT "enrollment_course_course_same_school_fk";--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "enrollment_course" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "lesson_pack" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
-- Every existing course, enrollment and lesson pack is sold by its school's default entity
-- (0041 gave each school one). Each enrollment_course row takes its enrollment's entity,
-- which is then also its course's.
UPDATE "course" AS "x" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."is_default" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
UPDATE "enrollment" AS "x" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."is_default" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
UPDATE "enrollment_course" AS "x" SET "billing_entity_id" = "i"."billing_entity_id"
FROM "enrollment" AS "i" WHERE "i"."school_id" = "x"."school_id" AND "i"."id" = "x"."enrollment_id" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
UPDATE "lesson_pack" AS "x" SET "billing_entity_id" = "e"."id"
FROM "billing_entity" AS "e" WHERE "e"."school_id" = "x"."school_id" AND "e"."is_default" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
-- A row left without its entity (a school without a default entity) fails here.
ALTER TABLE "course" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_course" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_pack" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
-- Targets of the three-column keys first, then the keys.
ALTER TABLE "course" ADD CONSTRAINT "course_school_id_id_billing_entity_id_unique" UNIQUE("school_id","id","billing_entity_id");--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_school_id_id_billing_entity_id_unique" UNIQUE("school_id","id","billing_entity_id");--> statement-breakpoint
ALTER TABLE "lesson_pack" ADD CONSTRAINT "lesson_pack_school_id_id_billing_entity_id_unique" UNIQUE("school_id","id","billing_entity_id");--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_billing_entity_same_school_fk" FOREIGN KEY ("school_id","billing_entity_id") REFERENCES "public"."billing_entity"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_billing_entity_same_school_fk" FOREIGN KEY ("school_id","billing_entity_id") REFERENCES "public"."billing_entity"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_pack" ADD CONSTRAINT "lesson_pack_billing_entity_same_school_fk" FOREIGN KEY ("school_id","billing_entity_id") REFERENCES "public"."billing_entity"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_course" ADD CONSTRAINT "enrollment_course_enrollment_same_entity_fk" FOREIGN KEY ("school_id","enrollment_id","billing_entity_id") REFERENCES "public"."enrollment"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_course" ADD CONSTRAINT "enrollment_course_course_same_entity_fk" FOREIGN KEY ("school_id","course_id","billing_entity_id") REFERENCES "public"."course"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;
