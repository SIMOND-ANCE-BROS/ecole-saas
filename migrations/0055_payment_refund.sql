-- Refunds to a payer (#294): a negative payment of kind 'refund', cancelling no payment.
-- The checks never name 'refund': a value added to an enum cannot be used in the
-- transaction that adds it. Existing rows already satisfy both: an ordinary payment is
-- positive without a kind (collect), a reverse entry negative with one (0037).
ALTER TYPE "public"."reversal_kind" ADD VALUE 'refund';--> statement-breakpoint
ALTER TABLE "payment" DROP CONSTRAINT "payment_reversal_kind";--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_sign" CHECK (("payment"."reversal_kind" IS NULL) = ("payment"."amount_cents" > 0));--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_reversal_kind" CHECK (coalesce("payment"."reversal_kind" IN ('correction', 'rejection'), false) = ("payment"."corrects_id" IS NOT NULL));