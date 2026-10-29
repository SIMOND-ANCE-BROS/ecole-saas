-- Unit of a course's own instructor rate (#268).
ALTER TABLE "course" ADD COLUMN "instructor_rate_pay_mode" "pay_mode";--> statement-breakpoint
-- Until #265 a pay mode change was refused while any course of the instructor had a rate:
-- every existing rate is in the instructor's current pay mode. Run by the owner role, which
-- RLS does not filter here; if it did, no row would be filled and the constraint below would
-- fail the migration rather than leave a rate without its unit.
UPDATE "course" SET "instructor_rate_pay_mode" = "instructor"."pay_mode"
FROM "instructor"
WHERE "instructor"."school_id" = "course"."school_id"
  AND "instructor"."id" = "course"."instructor_id"
  AND "course"."instructor_rate_cents" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_instructor_rate_unit" CHECK (("course"."instructor_rate_cents" IS NULL) = ("course"."instructor_rate_pay_mode" IS NULL));
