CREATE TYPE "public"."fournisseur_agenda" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TABLE "connexion_agenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"intervenant_id" uuid NOT NULL,
	"fournisseur" "fournisseur_agenda" NOT NULL,
	"compte" text,
	"jeton_chiffre" text NOT NULL,
	"derniere_synchro" timestamp with time zone,
	"erreur" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connexion_agenda_intervenant_id_unique" UNIQUE("intervenant_id")
);
--> statement-breakpoint
ALTER TABLE "connexion_agenda" ADD CONSTRAINT "connexion_agenda_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connexion_agenda" ADD CONSTRAINT "connexion_agenda_intervenant_meme_ecole_fk" FOREIGN KEY ("ecole_id","intervenant_id") REFERENCES "public"."intervenant"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Isolation multi-école des connexions d'agenda (modèle : 0001_rls.sql).
ALTER TABLE connexion_agenda ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE connexion_agenda FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON connexion_agenda
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);
