-- Ordre corrigé à la main : la contrainte unique ciblée doit exister avant la clé étrangère composite.
ALTER TABLE "discipline" ADD CONSTRAINT "discipline_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "tarif" DROP CONSTRAINT "tarif_discipline_id_discipline_id_fk";--> statement-breakpoint
ALTER TABLE "tarif" ADD CONSTRAINT "tarif_discipline_meme_ecole_fk" FOREIGN KEY ("ecole_id","discipline_id") REFERENCES "public"."discipline"("ecole_id","id") ON DELETE no action ON UPDATE no action;
