CREATE TYPE "public"."recurrence_cours" AS ENUM('hebdomadaire', 'quinzaine', 'dates');--> statement-breakpoint
CREATE TABLE "cours_date" (
	"ecole_id" uuid NOT NULL,
	"cours_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "cours_date_cours_id_date_pk" PRIMARY KEY("cours_id","date")
);
--> statement-breakpoint
ALTER TABLE "cours" ADD COLUMN "recurrence" "recurrence_cours" DEFAULT 'hebdomadaire' NOT NULL;--> statement-breakpoint
ALTER TABLE "cours" ADD COLUMN "date_debut" date;--> statement-breakpoint
ALTER TABLE "cours" ADD COLUMN "date_fin" date;--> statement-breakpoint
ALTER TABLE "cours_date" ADD CONSTRAINT "cours_date_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours_date" ADD CONSTRAINT "cours_date_cours_meme_ecole_fk" FOREIGN KEY ("ecole_id","cours_id") REFERENCES "public"."cours"("ecole_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Cours existants sans jour (stages) : à dates précises, avant la contrainte.
UPDATE "cours" SET "recurrence" = 'dates' WHERE "jour_semaine" IS NULL;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_recurrence_jour" CHECK (("cours"."recurrence" = 'dates') = ("cours"."jour_semaine" IS NULL));--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_periode" CHECK ("cours"."date_debut" IS NULL OR "cours"."date_fin" IS NULL OR "cours"."date_debut" <= "cours"."date_fin");--> statement-breakpoint
-- Isolation multi-école des dates de cours ponctuels (modèle : 0001_rls.sql).
ALTER TABLE cours_date ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE cours_date FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON cours_date
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);
