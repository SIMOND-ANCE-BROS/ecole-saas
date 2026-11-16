-- A retry of « Envoyer à nouveau » or « Abandonner » on a rejected invoice gets the first result back (#352, #260).
ALTER TABLE "submission" DROP CONSTRAINT "submission_kind";--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_kind" CHECK ("submission"."kind" IN ('payment', 'enrollment', 'course', 'lesson_pack', 'workshop_signup', 'rejected_invoice'));
