-- Invoice outbox (#304, ADR 0007): the invoice row is the outbox. Columns added to a table holding
-- issued invoices: ADD COLUMN fires no row trigger, so `invoice_issued_immutable` is unaffected and
-- left as it is. The outbox writes nothing on an issued invoice: the number, date, tool and the
-- end of the claim are written by the very statement that moves a `tool_draft` to `issued`, which
-- the trigger allows (it only freezes rows already issued); only `pdf_url` may change afterwards.
-- Must run as a superuser or BYPASSRLS role (#279): `invoicing_due_work()` is owned by the role
-- running it and reads invoices of every school; under FORCE ROW LEVEL SECURITY another owner would
-- see none and the sweep would silently send nothing.
DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Migration 0057 must run as a role that bypasses RLS (#279), not %', current_user;
  END IF;
END $$;--> statement-breakpoint
DROP INDEX "invoice_one_draft";--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "claimed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "send_error_kind" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "send_error_code" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "tool_total_incl_tax_cents" integer;--> statement-breakpoint
CREATE INDEX "invoice_outbox" ON "invoice" USING btree ("billing_entity_id","next_attempt_at") WHERE "invoice"."status" IN ('to_send', 'tool_draft') AND "invoice"."credit_note_of" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_one_draft" ON "invoice" USING btree ("school_id","payer_id","billing_entity_id","season_id") WHERE "invoice"."status" = 'to_send' AND "invoice"."attempts" = 0 AND "invoice"."credit_note_of" IS NULL AND "invoice"."season_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_attempts" CHECK ("invoice"."attempts" >= 0);--> statement-breakpoint
-- Work of the sweep route, across schools: the (school, business) pairs having an invoice due for
-- sending through an active connector, and nothing else (no amount, no payer, no credential). Each
-- pair is then handled by the application inside withSchool(), under RLS. SECURITY DEFINER: owned
-- by the migration role, which bypasses RLS (#279); search_path empty, every name qualified.
CREATE FUNCTION invoicing_due_work() RETURNS TABLE (school_id uuid, billing_entity_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT i.school_id, i.billing_entity_id
  FROM public.invoice i
  JOIN public.invoicing_connector c ON c.school_id = i.school_id AND c.billing_entity_id = i.billing_entity_id
  WHERE c.active
    AND i.status IN ('to_send', 'tool_draft')
    AND i.credit_note_of IS NULL
    AND i.next_attempt_at <= pg_catalog.now()
    AND (i.claimed_until IS NULL OR i.claimed_until <= pg_catalog.now())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION invoicing_due_work() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION invoicing_due_work() TO app_user;
