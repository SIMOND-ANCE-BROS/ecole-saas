-- Kind of a reverse entry (#272), instead of telling it apart by its French reference.
CREATE TYPE "public"."reversal_kind" AS ENUM('correction', 'rejection');--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "reversal_kind" "reversal_kind";--> statement-breakpoint
-- Backfill of the reverse entries written before this migration. Until #272 their reference
-- was the label (« Paiement rejeté » for a rejection, « Correction » otherwise): the kind is
-- read from it, and the reverse entry takes back the reference and issuer of the payment it
-- corrects (cheque number, bank), as new reverse entries do.
--
-- Payments are immutable: the trigger "payment_immutable" refuses any UPDATE. Disabling it
-- here, for this one statement inside the migration's transaction, is the only exception
-- (#272, checked by migration-reviewer); it is enabled again right after, in the same migration.
-- Must run as a superuser or BYPASSRLS role: under FORCE ROW LEVEL SECURITY another owner sees
-- no row, nothing is filled and the check constraint below fails the migration rather than
-- leave a reverse entry without its kind (#279).
ALTER TABLE "payment" DISABLE TRIGGER "payment_immutable";--> statement-breakpoint
UPDATE "payment" AS "r" SET
  "reversal_kind" = CASE WHEN "r"."reference" = 'Paiement rejeté' THEN 'rejection'::"reversal_kind" ELSE 'correction'::"reversal_kind" END,
  "reference" = CASE WHEN "r"."reference" IN ('Paiement rejeté', 'Correction') THEN "o"."reference" ELSE "r"."reference" END,
  "issuer" = coalesce("r"."issuer", "o"."issuer")
FROM "payment" AS "o"
WHERE "o"."school_id" = "r"."school_id"
  AND "o"."id" = "r"."corrects_id";--> statement-breakpoint
ALTER TABLE "payment" ENABLE TRIGGER "payment_immutable";--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_reversal_kind" CHECK (("payment"."reversal_kind" IS NULL) = ("payment"."corrects_id" IS NULL));
