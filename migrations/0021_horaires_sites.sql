CREATE TABLE "horaire_site" (
	"ecole_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"jour_semaine" smallint NOT NULL,
	"ouverture" time NOT NULL,
	"fermeture" time NOT NULL,
	CONSTRAINT "horaire_site_site_id_jour_semaine_pk" PRIMARY KEY("site_id","jour_semaine"),
	CONSTRAINT "horaire_site_jour" CHECK ("horaire_site"."jour_semaine" BETWEEN 1 AND 7),
	CONSTRAINT "horaire_site_ordre" CHECK ("horaire_site"."fermeture" > "horaire_site"."ouverture")
);
--> statement-breakpoint
ALTER TABLE "horaire_site" ADD CONSTRAINT "horaire_site_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horaire_site" ADD CONSTRAINT "horaire_site_site_meme_ecole_fk" FOREIGN KEY ("ecole_id","site_id") REFERENCES "public"."site"("ecole_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Isolation multi-école des horaires des sites (modèle : 0001_rls.sql).
ALTER TABLE horaire_site ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE horaire_site FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON horaire_site
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);
