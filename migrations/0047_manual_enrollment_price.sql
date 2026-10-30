-- A price typed by the front desk on an enrollment, with its reason (#292). The net price
-- becomes the typed one when there is one: PostgreSQL 16 cannot change the expression of a
-- generated column, so it is dropped and added again (recomputed from the stored columns),
-- after the columns its expression reads.
ALTER TABLE "enrollment" ADD COLUMN "manual_price_cents" integer;--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "price_reason" text;--> statement-breakpoint
ALTER TABLE "enrollment" drop column "net_price_cents";--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "net_price_cents" integer GENERATED ALWAYS AS (coalesce(manual_price_cents, gross_price_cents - discount_cents)) STORED;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_manual_price" CHECK (("enrollment"."manual_price_cents" IS NULL) = ("enrollment"."price_reason" IS NULL) AND ("enrollment"."manual_price_cents" IS NULL OR "enrollment"."manual_price_cents" >= 0) AND ("enrollment"."price_reason" IS NULL OR btrim("enrollment"."price_reason") <> ''));
