CREATE TYPE "public"."email_provider" AS ENUM('brevo', 'resend');--> statement-breakpoint
CREATE TABLE "email_connector" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"provider" "email_provider" NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_connector_from_name" CHECK (char_length("email_connector"."from_name") BETWEEN 1 AND 70),
	CONSTRAINT "email_connector_from_address" CHECK (char_length("email_connector"."from_address") BETWEEN 3 AND 254),
	CONSTRAINT "email_connector_key" CHECK ("email_connector"."encrypted_api_key" LIKE 'v1.%')
);
--> statement-breakpoint
ALTER TABLE "email_connector" ADD CONSTRAINT "email_connector_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Multi-school isolation (model: 0001_rls.sql).
ALTER TABLE email_connector ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE email_connector FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY school_isolation ON email_connector
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
