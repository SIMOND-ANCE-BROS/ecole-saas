-- Siblings discount from the Nth eligible student, ranked from the most expensive package (#290). 1 keeps every student discounted, as before.
ALTER TABLE "discount" ADD COLUMN "from_rank" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "discount" ADD CONSTRAINT "discount_from_rank" CHECK ("discount"."from_rank" BETWEEN 1 AND 10);