ALTER TABLE "course" ADD COLUMN "instructor_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_instructor_rate" CHECK ("course"."instructor_rate_cents" >= 0);