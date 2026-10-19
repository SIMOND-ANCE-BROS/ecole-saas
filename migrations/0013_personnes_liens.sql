CREATE TYPE "public"."type_lien" AS ENUM('representant_legal', 'conjoint', 'autre');--> statement-breakpoint
CREATE TYPE "public"."type_personne" AS ENUM('particulier', 'professionnel');--> statement-breakpoint
CREATE TABLE "lien" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"personne_id" uuid NOT NULL,
	"lie_a_id" uuid NOT NULL,
	"type" "type_lien" NOT NULL,
	"contact_urgence" boolean DEFAULT false NOT NULL,
	"paie_pour" boolean DEFAULT false NOT NULL,
	CONSTRAINT "lien_personne_id_lie_a_id_unique" UNIQUE("personne_id","lie_a_id"),
	CONSTRAINT "lien_distinct" CHECK ("lien"."personne_id" <> "lien"."lie_a_id")
);
--> statement-breakpoint
CREATE TABLE "personne" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"type" "type_personne" DEFAULT 'particulier' NOT NULL,
	"nom" text NOT NULL,
	"prenom" text,
	"raison_sociale" text,
	"siren" char(9),
	"date_naissance" date,
	"email" text,
	"telephone" text,
	"adresse" text,
	"notes" text,
	"ref_outil" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personne_ecole_id_id_unique" UNIQUE("ecole_id","id"),
	CONSTRAINT "personne_pro_siren" CHECK ("personne"."type" = 'particulier' OR "personne"."siren" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "lien" ADD CONSTRAINT "lien_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien" ADD CONSTRAINT "lien_personne_meme_ecole_fk" FOREIGN KEY ("ecole_id","personne_id") REFERENCES "public"."personne"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien" ADD CONSTRAINT "lien_lie_a_meme_ecole_fk" FOREIGN KEY ("ecole_id","lie_a_id") REFERENCES "public"."personne"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personne" ADD CONSTRAINT "personne_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lien_lie_a_id_index" ON "lien" USING btree ("lie_a_id");--> statement-breakpoint
CREATE INDEX "personne_ecole_id_nom_index" ON "personne" USING btree ("ecole_id","nom");--> statement-breakpoint
-- Isolation multi-école des personnes et des liens (modèle : 0001_rls.sql).
ALTER TABLE personne ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE personne FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON personne
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE lien ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE lien FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON lien
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);
