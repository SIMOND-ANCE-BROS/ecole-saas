-- Day of the drop-out of an enrollment (#284): the student stays on attendance sheets up to
-- this day included. Nullable: drop-outs written before have no date, and main's code never sets it.
ALTER TABLE "enrollment" ADD COLUMN "dropped_on" date;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_dropped_on" CHECK ("enrollment"."dropped_on" IS NULL OR "enrollment"."status" = 'dropped');