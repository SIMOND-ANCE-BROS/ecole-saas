-- What a reverse entry may target (#356), checked by the database as well as by the code
-- (`correctPayment`, `cancelRefundPayment` in src/db/payments.ts). A new guard on "payment":
-- a BEFORE INSERT trigger, separate from "payment_immutable" (UPDATE and DELETE), which is
-- left untouched, as is Row Level Security.
--
-- For a row whose corrects_id is set:
--   * a 'correction' or a 'rejection' targets an ordinary payment (no kind), a
--     'refund_cancellation' targets a 'refund' (constraint name "payment_reverse_target");
--   * the reverse entry has the target's payer (same name);
--   * the reverse entries of a target never cancel more than its amount
--     ("payment_reverse_cap").
-- The kinds are compared as text, as in the checks of 0056: a new database applies every
-- migration in one transaction, where an enum value added in it cannot be used. A row the
-- checks refuse (no kind, a 'refund' with corrects_id, the wrong sign) is left to them:
-- "payment_reversal_kind" and "payment_sign" name the fault. A target of another school or business is not found here and is
-- left to the composite key "payment_corrects_same_entity_fk", which refuses it.
--
-- Locks (src/db/payment-locks.ts, #360): the payer first, then the target payment, both
-- FOR NO KEY UPDATE, in that order. Every writer of a reverse entry already holds both
-- (`lockPayerAndPaymentsOf`, `lockPayers` + `lockPaymentsOfPayer`): asking again returns at
-- once. A writer outside that code still takes them in the documented order, and two reverse
-- entries of one payment then wait for each other, so the total read below, a statement of
-- its own after the locks, includes the other one once committed. The function runs as the
-- caller (no SECURITY DEFINER): under app_user, RLS keeps it within the current school.
CREATE INDEX "payment_school_id_corrects_id_index" ON "payment" USING btree ("school_id","corrects_id");--> statement-breakpoint
CREATE FUNCTION "payment_reverse_target"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target record;
  cancelled bigint;
BEGIN
  -- A row the checks refuse anyway (no kind, a refund, the wrong sign) is left to them.
  IF NEW.reversal_kind IS NULL OR NEW.reversal_kind::text NOT IN ('correction', 'rejection', 'refund_cancellation')
     OR (NEW.reversal_kind::text = 'refund_cancellation') <> (NEW.amount_cents > 0) THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM person WHERE school_id = NEW.school_id AND id = NEW.payer_id FOR NO KEY UPDATE;
  SELECT p.payer_id, p.amount_cents, p.reversal_kind::text AS kind INTO target
  FROM payment p
  WHERE p.school_id = NEW.school_id AND p.id = NEW.corrects_id AND p.billing_entity_id = NEW.billing_entity_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF (CASE WHEN NEW.reversal_kind::text = 'refund_cancellation' THEN target.kind IS DISTINCT FROM 'refund'
           ELSE target.kind IS NOT NULL END) THEN
    RAISE EXCEPTION 'a reverse entry of kind % cannot target a payment of kind %',
      NEW.reversal_kind, coalesce(target.kind, 'none')
      USING ERRCODE = 'check_violation', TABLE = 'payment', CONSTRAINT = 'payment_reverse_target';
  END IF;
  IF NEW.payer_id <> target.payer_id THEN
    RAISE EXCEPTION 'a reverse entry has the payer of the payment it targets'
      USING ERRCODE = 'check_violation', TABLE = 'payment', CONSTRAINT = 'payment_reverse_target';
  END IF;
  SELECT coalesce(sum(c.amount_cents), 0) INTO cancelled
  FROM payment c WHERE c.school_id = NEW.school_id AND c.corrects_id = NEW.corrects_id;
  -- Reverse entries have the sign opposite to their target (checks "payment_sign" and
  -- "payment_reversal_kind", and the kinds above): their total, counted in the direction
  -- that cancels, never goes beyond the target's amount.
  IF sign(-target.amount_cents) * (cancelled + NEW.amount_cents) > abs(target.amount_cents) THEN
    RAISE EXCEPTION 'reverse entries cannot cancel more than the payment they target'
      USING ERRCODE = 'check_violation', TABLE = 'payment', CONSTRAINT = 'payment_reverse_cap';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "payment_reverse_target" BEFORE INSERT ON "payment"
  FOR EACH ROW WHEN (NEW.corrects_id IS NOT NULL) EXECUTE FUNCTION "payment_reverse_target"();
