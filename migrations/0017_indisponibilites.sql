CREATE TYPE "public"."origine_indisponibilite" AS ENUM('saisie', 'google', 'microsoft');--> statement-breakpoint
CREATE TABLE "indisponibilite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"intervenant_id" uuid NOT NULL,
	"debut" timestamp with time zone NOT NULL,
	"fin" timestamp with time zone NOT NULL,
	"origine" "origine_indisponibilite" DEFAULT 'saisie' NOT NULL,
	"libelle" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indisponibilite_fin" CHECK ("indisponibilite"."fin" > "indisponibilite"."debut")
);
--> statement-breakpoint
ALTER TABLE "indisponibilite" ADD CONSTRAINT "indisponibilite_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indisponibilite" ADD CONSTRAINT "indisponibilite_intervenant_meme_ecole_fk" FOREIGN KEY ("ecole_id","intervenant_id") REFERENCES "public"."intervenant"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "indisponibilite_intervenant_id_debut_index" ON "indisponibilite" USING btree ("intervenant_id","debut");--> statement-breakpoint
-- Isolation multi-école des indisponibilités (modèle : 0001_rls.sql).
ALTER TABLE indisponibilite ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE indisponibilite FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON indisponibilite
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);
