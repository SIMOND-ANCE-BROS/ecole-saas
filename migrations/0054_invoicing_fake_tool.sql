-- Simulation tool (#303, ADR 0007): the invoicing tool `fake`, refused by the application unless
-- INVOICING_FAKE_ALLOWED=1. A « TEST- » number belongs to the fake tool only and the fake tool gives
-- no other one. Adding a CHECK touches no row: the issued-invoice immutability trigger is unaffected.
ALTER TYPE "public"."invoicing_tool" ADD VALUE 'fake';--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_fake_number" CHECK ("invoice"."number" IS NULL OR (left("invoice"."number", 5) = 'TEST-') = (coalesce("invoice"."tool"::text, '') = 'fake'));