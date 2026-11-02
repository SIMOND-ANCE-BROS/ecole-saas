-- A lesson pack only counts lessons of a course sold by its own business (#322, ADR 0006).
-- Lessons carry their course's entity, kept equal by a three-column key to the course with
-- ON UPDATE CASCADE (a course whose lessons are not counted may still change entity, its
-- lessons follow). Each lesson_pack_usage row carries its pack's entity, and two
-- three-column keys tie it to both the pack and the lesson, so the database refuses a pack
-- of one business counting a lesson of another, and a change of entity of a course with a
-- counted lesson (its cascade to the lesson) or of a pack with a usage.
--
-- Must run as a superuser or BYPASSRLS role (#279): lesson, course, lesson_pack and
-- lesson_pack_usage force Row Level Security, so another owner would see no row and
-- backfill nothing. No immutable table is touched (no trigger is disabled).
DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Migration 0060 must run as a role that bypasses RLS (#279), not %', current_user;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lesson" DROP CONSTRAINT "lesson_course_same_school_fk";--> statement-breakpoint
ALTER TABLE "lesson_pack_usage" DROP CONSTRAINT "lesson_pack_usage_lesson_pack_same_school_fk";--> statement-breakpoint
ALTER TABLE "lesson_pack_usage" DROP CONSTRAINT "lesson_pack_usage_lesson_same_school_fk";--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "lesson_pack_usage" ADD COLUMN "billing_entity_id" uuid;--> statement-breakpoint
-- Each lesson takes its course's entity, each usage its pack's.
UPDATE "lesson" AS "x" SET "billing_entity_id" = "c"."billing_entity_id"
FROM "course" AS "c" WHERE "c"."school_id" = "x"."school_id" AND "c"."id" = "x"."course_id" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
UPDATE "lesson_pack_usage" AS "x" SET "billing_entity_id" = "p"."billing_entity_id"
FROM "lesson_pack" AS "p" WHERE "p"."school_id" = "x"."school_id" AND "p"."id" = "x"."lesson_pack_id" AND "x"."billing_entity_id" IS NULL;--> statement-breakpoint
-- A usage counting a lesson of another entity than its pack has to be corrected by hand
-- before migrating, never moved silently: named here by technical ids only.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(u.lesson_pack_id || '/' || u.lesson_id, ', ') INTO bad
  FROM lesson_pack_usage u JOIN lesson l ON l.school_id = u.school_id AND l.id = u.lesson_id
  WHERE l.billing_entity_id IS DISTINCT FROM u.billing_entity_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0060: lesson pack usages across two entities (pack/lesson): %', bad;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lesson" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_pack_usage" ALTER COLUMN "billing_entity_id" SET NOT NULL;--> statement-breakpoint
-- Target of the usage's key to the lesson first, then the keys. A usage counting a lesson of
-- another entity than its pack fails here: such a usage has to be corrected by hand before
-- migrating, never moved silently.
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_school_id_id_billing_entity_id_unique" UNIQUE("school_id","id","billing_entity_id");--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_course_same_entity_fk" FOREIGN KEY ("school_id","course_id","billing_entity_id") REFERENCES "public"."course"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lesson_pack_usage" ADD CONSTRAINT "lesson_pack_usage_lesson_pack_same_entity_fk" FOREIGN KEY ("school_id","lesson_pack_id","billing_entity_id") REFERENCES "public"."lesson_pack"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_pack_usage" ADD CONSTRAINT "lesson_pack_usage_lesson_same_entity_fk" FOREIGN KEY ("school_id","lesson_id","billing_entity_id") REFERENCES "public"."lesson"("school_id","id","billing_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The keys' checks when a lesson changes entity (a course's cascade) or is deleted.
CREATE INDEX "lesson_pack_usage_lesson_id_index" ON "lesson_pack_usage" USING btree ("lesson_id");--> statement-breakpoint
-- A lesson inserted without its entity takes its course's (raw SQL inserts, fixtures, a future
-- import); the application names it (syncLessons). The key still checks a named one. Runs as
-- the inserting role, under its Row Level Security: it only ever reads the row's own course.
CREATE FUNCTION lesson_entity_from_course() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.billing_entity_id IS NULL THEN
    SELECT billing_entity_id INTO NEW.billing_entity_id
    FROM course WHERE school_id = NEW.school_id AND id = NEW.course_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER lesson_billing_entity_default BEFORE INSERT ON lesson
  FOR EACH ROW EXECUTE FUNCTION lesson_entity_from_course();
