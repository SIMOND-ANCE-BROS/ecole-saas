-- Ordre revu à la main : drizzle-kit supprimait les tables (en CASCADE) avant
-- leurs contraintes, puis échouait sur ces contraintes déjà supprimées.
ALTER TABLE "carnet" DROP CONSTRAINT "carnet_payeur_meme_ecole_fk";
--> statement-breakpoint
ALTER TABLE "document_danseur" DROP CONSTRAINT "document_danseur_danseur_meme_ecole_fk";
--> statement-breakpoint
ALTER TABLE "facture" DROP CONSTRAINT "facture_payeur_meme_ecole_fk";
--> statement-breakpoint
ALTER TABLE "inscription" DROP CONSTRAINT "inscription_payeur_meme_ecole_fk";
--> statement-breakpoint
ALTER TABLE "inscription_cours" DROP CONSTRAINT "inscription_cours_danseur_meme_ecole_fk";
--> statement-breakpoint
ALTER TABLE "paiement" DROP CONSTRAINT "paiement_payeur_meme_ecole_fk";
--> statement-breakpoint
ALTER TABLE "presence" DROP CONSTRAINT "presence_danseur_meme_ecole_fk";
--> statement-breakpoint
DROP TABLE "danseur";
--> statement-breakpoint
DROP TABLE "payeur";
--> statement-breakpoint
ALTER TABLE "carnet" ADD CONSTRAINT "carnet_payeur_meme_ecole_fk" FOREIGN KEY ("ecole_id","payeur_id") REFERENCES "public"."personne"("ecole_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_danseur" ADD CONSTRAINT "document_danseur_danseur_meme_ecole_fk" FOREIGN KEY ("ecole_id","danseur_id") REFERENCES "public"."personne"("ecole_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "facture" ADD CONSTRAINT "facture_payeur_meme_ecole_fk" FOREIGN KEY ("ecole_id","payeur_id") REFERENCES "public"."personne"("ecole_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inscription" ADD CONSTRAINT "inscription_payeur_meme_ecole_fk" FOREIGN KEY ("ecole_id","payeur_id") REFERENCES "public"."personne"("ecole_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inscription_cours" ADD CONSTRAINT "inscription_cours_danseur_meme_ecole_fk" FOREIGN KEY ("ecole_id","danseur_id") REFERENCES "public"."personne"("ecole_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "paiement" ADD CONSTRAINT "paiement_payeur_meme_ecole_fk" FOREIGN KEY ("ecole_id","payeur_id") REFERENCES "public"."personne"("ecole_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_danseur_meme_ecole_fk" FOREIGN KEY ("ecole_id","danseur_id") REFERENCES "public"."personne"("ecole_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DROP TYPE "public"."type_payeur";
--> statement-breakpoint
-- Fusion (#67) : un adulte qui était son propre payeur (payeur particulier et
-- danseur de mêmes nom et prénom) ne fait plus qu'une personne, celle du payeur.
CREATE TEMP TABLE fusion AS
SELECT l.lie_a_id AS doublon, l.personne_id AS garde
FROM lien l
JOIN personne p ON p.id = l.personne_id
JOIN personne d ON d.id = l.lie_a_id
WHERE l.paie_pour AND p.type = 'particulier'
  AND lower(p.nom) = lower(d.nom) AND lower(coalesce(p.prenom, '')) = lower(coalesce(d.prenom, ''));
--> statement-breakpoint
UPDATE personne p
SET date_naissance = coalesce(p.date_naissance, d.date_naissance), notes = coalesce(p.notes, d.notes)
FROM fusion f JOIN personne d ON d.id = f.doublon
WHERE p.id = f.garde;
--> statement-breakpoint
UPDATE inscription_cours SET danseur_id = f.garde FROM fusion f WHERE inscription_cours.danseur_id = f.doublon;
--> statement-breakpoint
UPDATE presence SET danseur_id = f.garde FROM fusion f WHERE presence.danseur_id = f.doublon;
--> statement-breakpoint
UPDATE document_danseur SET danseur_id = f.garde FROM fusion f WHERE document_danseur.danseur_id = f.doublon;
--> statement-breakpoint
-- Contacts d'urgence du doublon : reportés sur la personne gardée.
UPDATE lien SET lie_a_id = f.garde
FROM fusion f
WHERE lien.lie_a_id = f.doublon AND lien.personne_id <> f.garde;
--> statement-breakpoint
DELETE FROM lien USING fusion f WHERE lien.lie_a_id = f.doublon OR lien.personne_id = f.doublon;
--> statement-breakpoint
DELETE FROM personne USING fusion f WHERE personne.id = f.doublon;
--> statement-breakpoint
DROP TABLE fusion;
