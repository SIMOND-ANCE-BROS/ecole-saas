-- Cancelling a refund entered by mistake (#346): a positive payment of kind
-- 'refund_cancellation' whose corrects_id is the refund. The checks compare the kind as
-- text: a value added to an enum cannot be named in the transaction that adds it, and a
-- new database applies 0055 and this migration in one. Existing rows satisfy both checks:
-- ordinary payments are positive without corrects_id, corrections and rejections negative
-- with one, refunds negative without one.
ALTER TYPE "public"."reversal_kind" ADD VALUE 'refund_cancellation';--> statement-breakpoint
ALTER TABLE "payment" DROP CONSTRAINT "payment_reversal_kind";--> statement-breakpoint
ALTER TABLE "payment" DROP CONSTRAINT "payment_sign";--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_reversal_kind" CHECK (coalesce("payment"."reversal_kind"::text <> 'refund', false) = ("payment"."corrects_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_sign" CHECK (("payment"."reversal_kind" IS NULL OR "payment"."reversal_kind"::text = 'refund_cancellation') = ("payment"."amount_cents" > 0));