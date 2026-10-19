ALTER TABLE "tarif" DROP CONSTRAINT "tarif_saison_id_public_periodicite_duree_hebdo_minutes_nb_cours_max_unique";--> statement-breakpoint
ALTER TABLE "tarif" DROP COLUMN "duree_hebdo_minutes";--> statement-breakpoint
ALTER TABLE "tarif" DROP COLUMN "nb_cours_max";--> statement-breakpoint
ALTER TABLE "tarif" ADD CONSTRAINT "tarif_case_unique" UNIQUE NULLS NOT DISTINCT("saison_id","public","periodicite","combinaison","discipline_id");--> statement-breakpoint
ALTER TABLE "tarif" ADD CONSTRAINT "tarif_combinaison" CHECK (cardinality("tarif"."combinaison") >= 1 AND 0 < ALL("tarif"."combinaison"));