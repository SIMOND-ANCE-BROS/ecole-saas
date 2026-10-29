-- Second step of #298: the legal name, SIREN, VAT regime and VAT mention of a school now live
-- on its billing entities (0040 copied them onto each default entity). Nothing reads these
-- columns any more.
ALTER TABLE "school" DROP COLUMN "company_name";--> statement-breakpoint
ALTER TABLE "school" DROP COLUMN "siren";--> statement-breakpoint
ALTER TABLE "school" DROP COLUMN "vat_regime";--> statement-breakpoint
ALTER TABLE "school" DROP COLUMN "vat_mention";
