-- Invoice drafts (#302, ADR 0006): one draft per payer, business and season, never numbered
-- here (the business's invoicing tool numbers it when it issues it), and an issued invoice,
-- its lines and its installments frozen: only a credit note corrects them (CLAUDE.md §5).
ALTER TABLE "invoice" ADD COLUMN "season_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_season_same_school_fk" FOREIGN KEY ("school_id","season_id") REFERENCES "public"."season"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_one_draft" ON "invoice" USING btree ("school_id","payer_id","billing_entity_id","season_id") WHERE "invoice"."status" = 'to_send' AND "invoice"."credit_note_of" IS NULL AND "invoice"."season_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoice_season_id_index" ON "invoice" USING btree ("season_id");--> statement-breakpoint
-- A number only comes back from the tool: an invoice written before this check with a number
-- and still `to_send` is in the tool already. None is expected (nothing wrote invoices yet).
UPDATE "invoice" SET "status" = 'tool_draft' WHERE "status" = 'to_send' AND "number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_number_status" CHECK (("invoice"."status" <> 'to_send' OR "invoice"."number" IS NULL) AND ("invoice"."status" <> 'issued' OR ("invoice"."number" IS NOT NULL AND "invoice"."issued_on" IS NOT NULL)));--> statement-breakpoint
-- An issued invoice is never modified nor deleted; only its PDF link may be filled in later.
-- Its status is frozen too: the sending (#304) and credit notes will list the columns they
-- may still write. A data migration updating issued rows disables these triggers for that
-- statement, as 0037 does for payments.
CREATE FUNCTION invoice_issued_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'An issued invoice cannot be deleted: issue a credit note';
    END IF;
    IF (to_jsonb(NEW) - 'pdf_url') <> (to_jsonb(OLD) - 'pdf_url') THEN
      RAISE EXCEPTION 'An issued invoice cannot be modified: issue a credit note';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER invoice_issued_immutable BEFORE UPDATE OR DELETE ON invoice
  FOR EACH ROW EXECUTE FUNCTION invoice_issued_immutable();--> statement-breakpoint
-- Lines and installments of an issued invoice are neither added, modified nor deleted; an
-- installment's status alone still changes as payments settle it (#254). The invoice row is
-- read FOR SHARE: a line written while another transaction issues the invoice waits for it,
-- then sees it issued.
CREATE FUNCTION invoice_part_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'installment'
    AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM 1 FROM invoice WHERE school_id = OLD.school_id AND id = OLD.invoice_id AND status = 'issued' FOR SHARE;
    IF FOUND THEN
      RAISE EXCEPTION 'The % of an issued invoice cannot be modified: issue a credit note', TG_TABLE_NAME;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM 1 FROM invoice WHERE school_id = NEW.school_id AND id = NEW.invoice_id AND status = 'issued' FOR SHARE;
    IF FOUND THEN
      RAISE EXCEPTION 'The % of an issued invoice cannot be modified: issue a credit note', TG_TABLE_NAME;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER invoice_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON invoice_line
  FOR EACH ROW EXECUTE FUNCTION invoice_part_immutable();--> statement-breakpoint
CREATE TRIGGER installment_immutable BEFORE INSERT OR UPDATE OR DELETE ON installment
  FOR EACH ROW EXECUTE FUNCTION invoice_part_immutable();
