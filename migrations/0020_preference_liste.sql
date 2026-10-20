CREATE TABLE "preference_liste" (
	"ecole_id" uuid NOT NULL,
	"membre_id" uuid NOT NULL,
	"liste" text NOT NULL,
	"colonnes" text[] NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preference_liste_membre_id_liste_pk" PRIMARY KEY("membre_id","liste")
);
--> statement-breakpoint
ALTER TABLE "preference_liste" ADD CONSTRAINT "preference_liste_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_liste" ADD CONSTRAINT "preference_liste_membre_meme_ecole_fk" FOREIGN KEY ("ecole_id","membre_id") REFERENCES "public"."membre"("ecole_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Isolation multi-école des préférences de listes (modèle : 0001_rls.sql).
ALTER TABLE preference_liste ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE preference_liste FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON preference_liste
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);
