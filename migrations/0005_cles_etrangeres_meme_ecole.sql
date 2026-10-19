-- Ordre corrigé à la main : suppressions, puis contraintes uniques ciblées, puis clés étrangères composites.
ALTER TABLE "affectation_paiement" DROP CONSTRAINT "affectation_paiement_paiement_id_paiement_id_fk";--> statement-breakpoint
ALTER TABLE "affectation_paiement" DROP CONSTRAINT "affectation_paiement_echeance_id_echeance_id_fk";--> statement-breakpoint
ALTER TABLE "carnet" DROP CONSTRAINT "carnet_payeur_id_payeur_id_fk";--> statement-breakpoint
ALTER TABLE "carnet_utilisation" DROP CONSTRAINT "carnet_utilisation_carnet_id_carnet_id_fk";--> statement-breakpoint
ALTER TABLE "carnet_utilisation" DROP CONSTRAINT "carnet_utilisation_seance_id_seance_id_fk";--> statement-breakpoint
ALTER TABLE "cours" DROP CONSTRAINT "cours_saison_id_saison_id_fk";--> statement-breakpoint
ALTER TABLE "cours" DROP CONSTRAINT "cours_discipline_id_discipline_id_fk";--> statement-breakpoint
ALTER TABLE "cours" DROP CONSTRAINT "cours_salle_id_salle_id_fk";--> statement-breakpoint
ALTER TABLE "cours" DROP CONSTRAINT "cours_intervenant_id_intervenant_id_fk";--> statement-breakpoint
ALTER TABLE "danseur" DROP CONSTRAINT "danseur_payeur_id_payeur_id_fk";--> statement-breakpoint
ALTER TABLE "document_danseur" DROP CONSTRAINT "document_danseur_danseur_id_danseur_id_fk";--> statement-breakpoint
ALTER TABLE "echeance" DROP CONSTRAINT "echeance_facture_id_facture_id_fk";--> statement-breakpoint
ALTER TABLE "facture" DROP CONSTRAINT "facture_payeur_id_payeur_id_fk";--> statement-breakpoint
ALTER TABLE "facture" DROP CONSTRAINT "facture_avoir_de_facture_id_fk";--> statement-breakpoint
ALTER TABLE "fermeture" DROP CONSTRAINT "fermeture_saison_id_saison_id_fk";--> statement-breakpoint
ALTER TABLE "inscription" DROP CONSTRAINT "inscription_payeur_id_payeur_id_fk";--> statement-breakpoint
ALTER TABLE "inscription" DROP CONSTRAINT "inscription_saison_id_saison_id_fk";--> statement-breakpoint
ALTER TABLE "inscription" DROP CONSTRAINT "inscription_tarif_id_tarif_id_fk";--> statement-breakpoint
ALTER TABLE "inscription_cours" DROP CONSTRAINT "inscription_cours_inscription_id_inscription_id_fk";--> statement-breakpoint
ALTER TABLE "inscription_cours" DROP CONSTRAINT "inscription_cours_danseur_id_danseur_id_fk";--> statement-breakpoint
ALTER TABLE "inscription_cours" DROP CONSTRAINT "inscription_cours_cours_id_cours_id_fk";--> statement-breakpoint
ALTER TABLE "journal" DROP CONSTRAINT "journal_qui_membre_id_fk";--> statement-breakpoint
ALTER TABLE "ligne_facture" DROP CONSTRAINT "ligne_facture_facture_id_facture_id_fk";--> statement-breakpoint
ALTER TABLE "ligne_facture" DROP CONSTRAINT "ligne_facture_inscription_id_inscription_id_fk";--> statement-breakpoint
ALTER TABLE "ligne_facture" DROP CONSTRAINT "ligne_facture_carnet_id_carnet_id_fk";--> statement-breakpoint
ALTER TABLE "membre" DROP CONSTRAINT "membre_intervenant_id_intervenant_id_fk";--> statement-breakpoint
ALTER TABLE "paiement" DROP CONSTRAINT "paiement_payeur_id_payeur_id_fk";--> statement-breakpoint
ALTER TABLE "paiement" DROP CONSTRAINT "paiement_saisi_par_membre_id_fk";--> statement-breakpoint
ALTER TABLE "presence" DROP CONSTRAINT "presence_seance_id_seance_id_fk";--> statement-breakpoint
ALTER TABLE "presence" DROP CONSTRAINT "presence_danseur_id_danseur_id_fk";--> statement-breakpoint
ALTER TABLE "reduction" DROP CONSTRAINT "reduction_saison_id_saison_id_fk";--> statement-breakpoint
ALTER TABLE "releve_intervenant" DROP CONSTRAINT "releve_intervenant_intervenant_id_intervenant_id_fk";--> statement-breakpoint
ALTER TABLE "salle" DROP CONSTRAINT "salle_site_id_site_id_fk";--> statement-breakpoint
ALTER TABLE "seance" DROP CONSTRAINT "seance_cours_id_cours_id_fk";--> statement-breakpoint
ALTER TABLE "seance" DROP CONSTRAINT "seance_intervenant_id_intervenant_id_fk";--> statement-breakpoint
ALTER TABLE "tarif" DROP CONSTRAINT "tarif_saison_id_saison_id_fk";--> statement-breakpoint
ALTER TABLE "carnet" ADD CONSTRAINT "carnet_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "danseur" ADD CONSTRAINT "danseur_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "echeance" ADD CONSTRAINT "echeance_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "facture" ADD CONSTRAINT "facture_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "inscription" ADD CONSTRAINT "inscription_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "intervenant" ADD CONSTRAINT "intervenant_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "paiement" ADD CONSTRAINT "paiement_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "payeur" ADD CONSTRAINT "payeur_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "saison" ADD CONSTRAINT "saison_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "salle" ADD CONSTRAINT "salle_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "seance" ADD CONSTRAINT "seance_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "tarif" ADD CONSTRAINT "tarif_ecole_id_id_unique" UNIQUE("ecole_id","id");--> statement-breakpoint
ALTER TABLE "affectation_paiement" ADD CONSTRAINT "affectation_paiement_paiement_meme_ecole_fk" FOREIGN KEY ("ecole_id","paiement_id") REFERENCES "public"."paiement"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affectation_paiement" ADD CONSTRAINT "affectation_paiement_echeance_meme_ecole_fk" FOREIGN KEY ("ecole_id","echeance_id") REFERENCES "public"."echeance"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carnet" ADD CONSTRAINT "carnet_payeur_meme_ecole_fk" FOREIGN KEY ("ecole_id","payeur_id") REFERENCES "public"."payeur"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carnet_utilisation" ADD CONSTRAINT "carnet_utilisation_carnet_meme_ecole_fk" FOREIGN KEY ("ecole_id","carnet_id") REFERENCES "public"."carnet"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carnet_utilisation" ADD CONSTRAINT "carnet_utilisation_seance_meme_ecole_fk" FOREIGN KEY ("ecole_id","seance_id") REFERENCES "public"."seance"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_saison_meme_ecole_fk" FOREIGN KEY ("ecole_id","saison_id") REFERENCES "public"."saison"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_discipline_meme_ecole_fk" FOREIGN KEY ("ecole_id","discipline_id") REFERENCES "public"."discipline"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_salle_meme_ecole_fk" FOREIGN KEY ("ecole_id","salle_id") REFERENCES "public"."salle"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_intervenant_meme_ecole_fk" FOREIGN KEY ("ecole_id","intervenant_id") REFERENCES "public"."intervenant"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "danseur" ADD CONSTRAINT "danseur_payeur_meme_ecole_fk" FOREIGN KEY ("ecole_id","payeur_id") REFERENCES "public"."payeur"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_danseur" ADD CONSTRAINT "document_danseur_danseur_meme_ecole_fk" FOREIGN KEY ("ecole_id","danseur_id") REFERENCES "public"."danseur"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeance" ADD CONSTRAINT "echeance_facture_meme_ecole_fk" FOREIGN KEY ("ecole_id","facture_id") REFERENCES "public"."facture"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facture" ADD CONSTRAINT "facture_payeur_meme_ecole_fk" FOREIGN KEY ("ecole_id","payeur_id") REFERENCES "public"."payeur"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facture" ADD CONSTRAINT "facture_avoir_de_meme_ecole_fk" FOREIGN KEY ("ecole_id","avoir_de") REFERENCES "public"."facture"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fermeture" ADD CONSTRAINT "fermeture_saison_meme_ecole_fk" FOREIGN KEY ("ecole_id","saison_id") REFERENCES "public"."saison"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription" ADD CONSTRAINT "inscription_payeur_meme_ecole_fk" FOREIGN KEY ("ecole_id","payeur_id") REFERENCES "public"."payeur"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription" ADD CONSTRAINT "inscription_saison_meme_ecole_fk" FOREIGN KEY ("ecole_id","saison_id") REFERENCES "public"."saison"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription" ADD CONSTRAINT "inscription_tarif_meme_ecole_fk" FOREIGN KEY ("ecole_id","tarif_id") REFERENCES "public"."tarif"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription_cours" ADD CONSTRAINT "inscription_cours_inscription_meme_ecole_fk" FOREIGN KEY ("ecole_id","inscription_id") REFERENCES "public"."inscription"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription_cours" ADD CONSTRAINT "inscription_cours_danseur_meme_ecole_fk" FOREIGN KEY ("ecole_id","danseur_id") REFERENCES "public"."danseur"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription_cours" ADD CONSTRAINT "inscription_cours_cours_meme_ecole_fk" FOREIGN KEY ("ecole_id","cours_id") REFERENCES "public"."cours"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_qui_meme_ecole_fk" FOREIGN KEY ("ecole_id","qui") REFERENCES "public"."membre"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_facture" ADD CONSTRAINT "ligne_facture_facture_meme_ecole_fk" FOREIGN KEY ("ecole_id","facture_id") REFERENCES "public"."facture"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_facture" ADD CONSTRAINT "ligne_facture_inscription_meme_ecole_fk" FOREIGN KEY ("ecole_id","inscription_id") REFERENCES "public"."inscription"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_facture" ADD CONSTRAINT "ligne_facture_carnet_meme_ecole_fk" FOREIGN KEY ("ecole_id","carnet_id") REFERENCES "public"."carnet"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_intervenant_meme_ecole_fk" FOREIGN KEY ("ecole_id","intervenant_id") REFERENCES "public"."intervenant"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiement" ADD CONSTRAINT "paiement_payeur_meme_ecole_fk" FOREIGN KEY ("ecole_id","payeur_id") REFERENCES "public"."payeur"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiement" ADD CONSTRAINT "paiement_saisi_par_meme_ecole_fk" FOREIGN KEY ("ecole_id","saisi_par") REFERENCES "public"."membre"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_seance_meme_ecole_fk" FOREIGN KEY ("ecole_id","seance_id") REFERENCES "public"."seance"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_danseur_meme_ecole_fk" FOREIGN KEY ("ecole_id","danseur_id") REFERENCES "public"."danseur"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reduction" ADD CONSTRAINT "reduction_saison_meme_ecole_fk" FOREIGN KEY ("ecole_id","saison_id") REFERENCES "public"."saison"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releve_intervenant" ADD CONSTRAINT "releve_intervenant_intervenant_meme_ecole_fk" FOREIGN KEY ("ecole_id","intervenant_id") REFERENCES "public"."intervenant"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salle" ADD CONSTRAINT "salle_site_meme_ecole_fk" FOREIGN KEY ("ecole_id","site_id") REFERENCES "public"."site"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seance" ADD CONSTRAINT "seance_cours_meme_ecole_fk" FOREIGN KEY ("ecole_id","cours_id") REFERENCES "public"."cours"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seance" ADD CONSTRAINT "seance_intervenant_meme_ecole_fk" FOREIGN KEY ("ecole_id","intervenant_id") REFERENCES "public"."intervenant"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarif" ADD CONSTRAINT "tarif_saison_meme_ecole_fk" FOREIGN KEY ("ecole_id","saison_id") REFERENCES "public"."saison"("ecole_id","id") ON DELETE no action ON UPDATE no action;
