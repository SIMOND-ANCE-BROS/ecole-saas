CREATE TABLE "submission" (
	"school_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"kind" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_school_id_key_pk" PRIMARY KEY("school_id","key")
);
--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE submission ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE submission FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON submission
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
