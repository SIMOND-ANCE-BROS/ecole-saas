-- #440: « Envoyer à nouveau » restarts a full retry cycle. `attempts` keeps counting every
-- attempt ever made; the backoff and the 10-attempt limit count from `cycle_start_attempts`.
-- Adding a column with a constant default rewrites no row and fires no trigger: issued
-- invoices stay as they are (0052).
ALTER TABLE "invoice" ADD COLUMN "cycle_start_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_cycle_start_attempts" CHECK ("invoice"."cycle_start_attempts" BETWEEN 0 AND "invoice"."attempts");
