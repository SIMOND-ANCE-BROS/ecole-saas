CREATE TABLE "document_requirement" (
	"school_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"required" boolean NOT NULL,
	"minors_only" boolean NOT NULL,
	"validity_months" smallint,
	"due_within_days" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_requirement_school_id_type_pk" PRIMARY KEY("school_id","type"),
	CONSTRAINT "document_requirement_type" CHECK ("document_requirement"."type" <> 'other'),
	CONSTRAINT "document_requirement_validity" CHECK ("document_requirement"."validity_months" BETWEEN 1 AND 120),
	CONSTRAINT "document_requirement_due" CHECK ("document_requirement"."due_within_days" BETWEEN 0 AND 365)
);
--> statement-breakpoint
ALTER TABLE "student_document" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "document_requirement" ADD CONSTRAINT "document_requirement_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One row per student and type from now on (#287): its current state, the earlier ones in the
-- audit log. Nothing writes to this table before #287, but a duplicate entered by hand would
-- block the constraint: only the row valid the longest is kept (no expiry first, then the
-- latest end, then the id to break ties).
-- Must run as a superuser or BYPASSRLS role (#279): under FORCE ROW LEVEL SECURITY another
-- owner sees no row and deletes nothing; the unique constraint below, which sees every row,
-- then fails the migration rather than keep a duplicate.
DELETE FROM "student_document" AS "d"
USING "student_document" AS "k"
WHERE "k"."student_id" = "d"."student_id"
  AND "k"."type" = "d"."type"
  AND "k"."id" <> "d"."id"
  AND (coalesce("k"."valid_until", 'infinity'::date), "k"."id") > (coalesce("d"."valid_until", 'infinity'::date), "d"."id");--> statement-breakpoint
ALTER TABLE "student_document" ADD CONSTRAINT "student_document_student_id_type_unique" UNIQUE("student_id","type");--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE document_requirement ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE document_requirement FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON document_requirement
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
