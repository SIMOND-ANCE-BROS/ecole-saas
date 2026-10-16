CREATE TYPE "public"."mode_remuneration" AS ENUM('heure', 'cours', 'forfait_mensuel');--> statement-breakpoint
CREATE TYPE "public"."moyen_paiement" AS ENUM('cheque', 'especes', 'carte', 'virement', 'prelevement', 'cheque_vacances', 'pass_sport', 'autre');--> statement-breakpoint
CREATE TYPE "public"."outil_facturation" AS ENUM('pennylane', 'abby', 'shine');--> statement-breakpoint
CREATE TYPE "public"."periodicite" AS ENUM('trimestre', 'annee', 'unite');--> statement-breakpoint
CREATE TYPE "public"."public_tarif" AS ENUM('enfant', 'adulte', 'couple', 'etudiant');--> statement-breakpoint
CREATE TYPE "public"."regime_tva" AS ENUM('franchise_293b', 'assujetti', 'non_applicable');--> statement-breakpoint
CREATE TYPE "public"."role_membre" AS ENUM('direction', 'accueil', 'professeur');--> statement-breakpoint
CREATE TYPE "public"."statut_echeance" AS ENUM('a_venir', 'payee', 'partielle', 'en_retard', 'annulee');--> statement-breakpoint
CREATE TYPE "public"."statut_facture" AS ENUM('a_envoyer', 'brouillon_outil', 'emise', 'rejetee', 'annulee');--> statement-breakpoint
CREATE TYPE "public"."statut_inscription" AS ENUM('essai', 'liste_attente', 'active', 'abandon', 'terminee');--> statement-breakpoint
CREATE TYPE "public"."statut_intervenant" AS ENUM('micro_entreprise', 'societe', 'salarie');--> statement-breakpoint
CREATE TYPE "public"."statut_releve" AS ENUM('a_controler', 'conforme', 'ecart', 'paye');--> statement-breakpoint
CREATE TYPE "public"."statut_seance" AS ENUM('prevue', 'effectuee', 'annulee');--> statement-breakpoint
CREATE TYPE "public"."type_cours" AS ENUM('collectif', 'particulier', 'competition', 'stage');--> statement-breakpoint
CREATE TYPE "public"."type_document" AS ENUM('certificat_medical', 'autorisation_parentale', 'droit_image', 'autre');--> statement-breakpoint
CREATE TYPE "public"."type_payeur" AS ENUM('particulier', 'professionnel');--> statement-breakpoint
CREATE TABLE "affectation_paiement" (
	"ecole_id" uuid NOT NULL,
	"paiement_id" uuid NOT NULL,
	"echeance_id" uuid NOT NULL,
	"montant_centimes" integer NOT NULL,
	CONSTRAINT "affectation_paiement_paiement_id_echeance_id_pk" PRIMARY KEY("paiement_id","echeance_id")
);
--> statement-breakpoint
CREATE TABLE "carnet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"payeur_id" uuid NOT NULL,
	"nb_personnes" smallint NOT NULL,
	"seances_total" smallint NOT NULL,
	"prix_centimes" integer NOT NULL,
	"achete_le" date DEFAULT now() NOT NULL,
	CONSTRAINT "carnet_personnes" CHECK ("carnet"."nb_personnes" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE "carnet_utilisation" (
	"ecole_id" uuid NOT NULL,
	"carnet_id" uuid NOT NULL,
	"seance_id" uuid NOT NULL,
	CONSTRAINT "carnet_utilisation_carnet_id_seance_id_pk" PRIMARY KEY("carnet_id","seance_id")
);
--> statement-breakpoint
CREATE TABLE "connecteur_facturation" (
	"ecole_id" uuid PRIMARY KEY NOT NULL,
	"outil" "outil_facturation" NOT NULL,
	"identifiants_chiffres" text NOT NULL,
	"one_connect_actif" boolean DEFAULT false NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"maj_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"saison_id" uuid NOT NULL,
	"discipline_id" uuid NOT NULL,
	"salle_id" uuid NOT NULL,
	"intervenant_id" uuid NOT NULL,
	"type" "type_cours" DEFAULT 'collectif' NOT NULL,
	"niveau" text,
	"age_min" smallint,
	"age_max" smallint,
	"jour_semaine" smallint,
	"heure_debut" time NOT NULL,
	"duree_minutes" integer NOT NULL,
	"capacite_max" integer,
	CONSTRAINT "cours_jour" CHECK ("cours"."jour_semaine" BETWEEN 1 AND 7),
	CONSTRAINT "cours_duree" CHECK ("cours"."duree_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "danseur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"payeur_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"prenom" text NOT NULL,
	"date_naissance" date,
	"contact_urgence" text,
	"telephone_urgence" text,
	"notes" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discipline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"nom" text NOT NULL,
	CONSTRAINT "discipline_ecole_id_nom_unique" UNIQUE("ecole_id","nom")
);
--> statement-breakpoint
CREATE TABLE "document_danseur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"danseur_id" uuid NOT NULL,
	"type" "type_document" NOT NULL,
	"accorde" boolean DEFAULT true NOT NULL,
	"valide_jusqu" date,
	"fichier" text
);
--> statement-breakpoint
CREATE TABLE "echeance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"facture_id" uuid NOT NULL,
	"rang" smallint NOT NULL,
	"date_prevue" date NOT NULL,
	"montant_centimes" integer NOT NULL,
	"statut" "statut_echeance" DEFAULT 'a_venir' NOT NULL,
	CONSTRAINT "echeance_facture_id_rang_unique" UNIQUE("facture_id","rang")
);
--> statement-breakpoint
CREATE TABLE "ecole" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"slug" text NOT NULL,
	"raison_sociale" text,
	"siren" char(9),
	"regime_tva" "regime_tva" DEFAULT 'non_applicable' NOT NULL,
	"mention_tva" text,
	"fuseau" text DEFAULT 'Europe/Paris' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ecole_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "facture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"payeur_id" uuid NOT NULL,
	"statut" "statut_facture" DEFAULT 'a_envoyer' NOT NULL,
	"outil" "outil_facturation",
	"ref_outil" text,
	"numero" text,
	"date_emission" date,
	"total_ht_centimes" integer DEFAULT 0 NOT NULL,
	"total_tva_centimes" integer DEFAULT 0 NOT NULL,
	"total_ttc_centimes" integer DEFAULT 0 NOT NULL,
	"avoir_de" uuid,
	"pdf_url" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facture_ecole_id_numero_unique" UNIQUE("ecole_id","numero")
);
--> statement-breakpoint
CREATE TABLE "fermeture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"saison_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"debut" date NOT NULL,
	"fin" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"payeur_id" uuid NOT NULL,
	"saison_id" uuid NOT NULL,
	"tarif_id" uuid,
	"statut" "statut_inscription" DEFAULT 'active' NOT NULL,
	"date_inscription" date DEFAULT now() NOT NULL,
	"prix_brut_centimes" integer NOT NULL,
	"remise_centimes" integer DEFAULT 0 NOT NULL,
	"prix_net_centimes" integer GENERATED ALWAYS AS (prix_brut_centimes - remise_centimes) STORED,
	"reductions" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inscription_cours" (
	"ecole_id" uuid NOT NULL,
	"inscription_id" uuid NOT NULL,
	"danseur_id" uuid NOT NULL,
	"cours_id" uuid NOT NULL,
	CONSTRAINT "inscription_cours_inscription_id_danseur_id_cours_id_pk" PRIMARY KEY("inscription_id","danseur_id","cours_id")
);
--> statement-breakpoint
CREATE TABLE "intervenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"prenom" text NOT NULL,
	"email" text,
	"statut" "statut_intervenant" NOT NULL,
	"siren" char(9),
	"regime_tva" "regime_tva" NOT NULL,
	"est_dirigeant" boolean DEFAULT false NOT NULL,
	"mode_remuneration" "mode_remuneration" NOT NULL,
	"tarif_centimes" integer NOT NULL,
	"actif" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ecole_id" uuid NOT NULL,
	"quand" timestamp with time zone DEFAULT now() NOT NULL,
	"qui" uuid,
	"table_cible" text NOT NULL,
	"ligne_id" uuid NOT NULL,
	"action" text NOT NULL,
	"avant" jsonb,
	"apres" jsonb
);
--> statement-breakpoint
CREATE TABLE "ligne_facture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"facture_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"quantite_milliemes" integer DEFAULT 1000 NOT NULL,
	"prix_unitaire_centimes" integer NOT NULL,
	"taux_tva_points_base" integer DEFAULT 0 NOT NULL,
	"inscription_id" uuid,
	"carnet_id" uuid
);
--> statement-breakpoint
CREATE TABLE "membre" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "role_membre" NOT NULL,
	"intervenant_id" uuid,
	"actif" boolean DEFAULT true NOT NULL,
	CONSTRAINT "membre_ecole_id_user_id_unique" UNIQUE("ecole_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "paiement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"payeur_id" uuid NOT NULL,
	"date" date DEFAULT now() NOT NULL,
	"montant_centimes" integer NOT NULL,
	"moyen" "moyen_paiement" NOT NULL,
	"reference" text,
	"saisi_par" uuid,
	"synchro_outil" boolean DEFAULT false NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payeur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"type" "type_payeur" DEFAULT 'particulier' NOT NULL,
	"nom" text NOT NULL,
	"prenom" text,
	"raison_sociale" text,
	"siren" char(9),
	"email" text,
	"telephone" text,
	"adresse" text,
	"ref_outil" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payeur_pro_siren" CHECK ("payeur"."type" = 'particulier' OR "payeur"."siren" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "presence" (
	"ecole_id" uuid NOT NULL,
	"seance_id" uuid NOT NULL,
	"danseur_id" uuid NOT NULL,
	"present" boolean NOT NULL,
	CONSTRAINT "presence_seance_id_danseur_id_pk" PRIMARY KEY("seance_id","danseur_id")
);
--> statement-breakpoint
CREATE TABLE "reduction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"saison_id" uuid NOT NULL,
	"code" text NOT NULL,
	"taux_points_base" integer,
	"montant_centimes" integer,
	"non_cumulable_avec" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "reduction_saison_id_code_unique" UNIQUE("saison_id","code"),
	CONSTRAINT "reduction_valeur" CHECK ("reduction"."taux_points_base" IS NOT NULL OR "reduction"."montant_centimes" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "releve_intervenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"intervenant_id" uuid NOT NULL,
	"mois" date NOT NULL,
	"nb_seances" integer NOT NULL,
	"minutes" integer NOT NULL,
	"montant_du_centimes" integer NOT NULL,
	"facture_recue" text,
	"montant_facture_centimes" integer,
	"statut" "statut_releve" DEFAULT 'a_controler' NOT NULL,
	CONSTRAINT "releve_intervenant_intervenant_id_mois_unique" UNIQUE("intervenant_id","mois")
);
--> statement-breakpoint
CREATE TABLE "saison" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"date_debut" date NOT NULL,
	"date_fin" date NOT NULL,
	CONSTRAINT "saison_ecole_id_libelle_unique" UNIQUE("ecole_id","libelle"),
	CONSTRAINT "saison_dates" CHECK ("saison"."date_fin" > "saison"."date_debut")
);
--> statement-breakpoint
CREATE TABLE "salle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"capacite" integer
);
--> statement-breakpoint
CREATE TABLE "seance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"cours_id" uuid NOT NULL,
	"date" date NOT NULL,
	"statut" "statut_seance" DEFAULT 'prevue' NOT NULL,
	"intervenant_id" uuid NOT NULL,
	CONSTRAINT "seance_cours_id_date_unique" UNIQUE("cours_id","date")
);
--> statement-breakpoint
CREATE TABLE "site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"adresse" text NOT NULL,
	"permanence" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tarif" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"saison_id" uuid NOT NULL,
	"public" "public_tarif" NOT NULL,
	"periodicite" "periodicite" NOT NULL,
	"duree_hebdo_minutes" integer NOT NULL,
	"nb_cours_max" smallint,
	"prix_centimes" integer NOT NULL,
	CONSTRAINT "tarif_saison_id_public_periodicite_duree_hebdo_minutes_nb_cours_max_unique" UNIQUE("saison_id","public","periodicite","duree_hebdo_minutes","nb_cours_max")
);
--> statement-breakpoint
ALTER TABLE "affectation_paiement" ADD CONSTRAINT "affectation_paiement_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affectation_paiement" ADD CONSTRAINT "affectation_paiement_paiement_id_paiement_id_fk" FOREIGN KEY ("paiement_id") REFERENCES "public"."paiement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affectation_paiement" ADD CONSTRAINT "affectation_paiement_echeance_id_echeance_id_fk" FOREIGN KEY ("echeance_id") REFERENCES "public"."echeance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carnet" ADD CONSTRAINT "carnet_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carnet" ADD CONSTRAINT "carnet_payeur_id_payeur_id_fk" FOREIGN KEY ("payeur_id") REFERENCES "public"."payeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carnet_utilisation" ADD CONSTRAINT "carnet_utilisation_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carnet_utilisation" ADD CONSTRAINT "carnet_utilisation_carnet_id_carnet_id_fk" FOREIGN KEY ("carnet_id") REFERENCES "public"."carnet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carnet_utilisation" ADD CONSTRAINT "carnet_utilisation_seance_id_seance_id_fk" FOREIGN KEY ("seance_id") REFERENCES "public"."seance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connecteur_facturation" ADD CONSTRAINT "connecteur_facturation_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_saison_id_saison_id_fk" FOREIGN KEY ("saison_id") REFERENCES "public"."saison"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_discipline_id_discipline_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."discipline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_salle_id_salle_id_fk" FOREIGN KEY ("salle_id") REFERENCES "public"."salle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cours" ADD CONSTRAINT "cours_intervenant_id_intervenant_id_fk" FOREIGN KEY ("intervenant_id") REFERENCES "public"."intervenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "danseur" ADD CONSTRAINT "danseur_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "danseur" ADD CONSTRAINT "danseur_payeur_id_payeur_id_fk" FOREIGN KEY ("payeur_id") REFERENCES "public"."payeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discipline" ADD CONSTRAINT "discipline_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_danseur" ADD CONSTRAINT "document_danseur_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_danseur" ADD CONSTRAINT "document_danseur_danseur_id_danseur_id_fk" FOREIGN KEY ("danseur_id") REFERENCES "public"."danseur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeance" ADD CONSTRAINT "echeance_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeance" ADD CONSTRAINT "echeance_facture_id_facture_id_fk" FOREIGN KEY ("facture_id") REFERENCES "public"."facture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facture" ADD CONSTRAINT "facture_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facture" ADD CONSTRAINT "facture_payeur_id_payeur_id_fk" FOREIGN KEY ("payeur_id") REFERENCES "public"."payeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facture" ADD CONSTRAINT "facture_avoir_de_facture_id_fk" FOREIGN KEY ("avoir_de") REFERENCES "public"."facture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fermeture" ADD CONSTRAINT "fermeture_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fermeture" ADD CONSTRAINT "fermeture_saison_id_saison_id_fk" FOREIGN KEY ("saison_id") REFERENCES "public"."saison"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription" ADD CONSTRAINT "inscription_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription" ADD CONSTRAINT "inscription_payeur_id_payeur_id_fk" FOREIGN KEY ("payeur_id") REFERENCES "public"."payeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription" ADD CONSTRAINT "inscription_saison_id_saison_id_fk" FOREIGN KEY ("saison_id") REFERENCES "public"."saison"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription" ADD CONSTRAINT "inscription_tarif_id_tarif_id_fk" FOREIGN KEY ("tarif_id") REFERENCES "public"."tarif"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription_cours" ADD CONSTRAINT "inscription_cours_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription_cours" ADD CONSTRAINT "inscription_cours_inscription_id_inscription_id_fk" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription_cours" ADD CONSTRAINT "inscription_cours_danseur_id_danseur_id_fk" FOREIGN KEY ("danseur_id") REFERENCES "public"."danseur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscription_cours" ADD CONSTRAINT "inscription_cours_cours_id_cours_id_fk" FOREIGN KEY ("cours_id") REFERENCES "public"."cours"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervenant" ADD CONSTRAINT "intervenant_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_qui_membre_id_fk" FOREIGN KEY ("qui") REFERENCES "public"."membre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_facture" ADD CONSTRAINT "ligne_facture_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_facture" ADD CONSTRAINT "ligne_facture_facture_id_facture_id_fk" FOREIGN KEY ("facture_id") REFERENCES "public"."facture"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_facture" ADD CONSTRAINT "ligne_facture_inscription_id_inscription_id_fk" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_facture" ADD CONSTRAINT "ligne_facture_carnet_id_carnet_id_fk" FOREIGN KEY ("carnet_id") REFERENCES "public"."carnet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_intervenant_id_intervenant_id_fk" FOREIGN KEY ("intervenant_id") REFERENCES "public"."intervenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiement" ADD CONSTRAINT "paiement_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiement" ADD CONSTRAINT "paiement_payeur_id_payeur_id_fk" FOREIGN KEY ("payeur_id") REFERENCES "public"."payeur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiement" ADD CONSTRAINT "paiement_saisi_par_membre_id_fk" FOREIGN KEY ("saisi_par") REFERENCES "public"."membre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payeur" ADD CONSTRAINT "payeur_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_seance_id_seance_id_fk" FOREIGN KEY ("seance_id") REFERENCES "public"."seance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_danseur_id_danseur_id_fk" FOREIGN KEY ("danseur_id") REFERENCES "public"."danseur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reduction" ADD CONSTRAINT "reduction_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reduction" ADD CONSTRAINT "reduction_saison_id_saison_id_fk" FOREIGN KEY ("saison_id") REFERENCES "public"."saison"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releve_intervenant" ADD CONSTRAINT "releve_intervenant_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releve_intervenant" ADD CONSTRAINT "releve_intervenant_intervenant_id_intervenant_id_fk" FOREIGN KEY ("intervenant_id") REFERENCES "public"."intervenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saison" ADD CONSTRAINT "saison_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salle" ADD CONSTRAINT "salle_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salle" ADD CONSTRAINT "salle_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seance" ADD CONSTRAINT "seance_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seance" ADD CONSTRAINT "seance_cours_id_cours_id_fk" FOREIGN KEY ("cours_id") REFERENCES "public"."cours"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seance" ADD CONSTRAINT "seance_intervenant_id_intervenant_id_fk" FOREIGN KEY ("intervenant_id") REFERENCES "public"."intervenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarif" ADD CONSTRAINT "tarif_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarif" ADD CONSTRAINT "tarif_saison_id_saison_id_fk" FOREIGN KEY ("saison_id") REFERENCES "public"."saison"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cours_saison_id_jour_semaine_index" ON "cours" USING btree ("saison_id","jour_semaine");--> statement-breakpoint
CREATE INDEX "danseur_payeur_id_index" ON "danseur" USING btree ("payeur_id");--> statement-breakpoint
CREATE INDEX "danseur_ecole_id_nom_index" ON "danseur" USING btree ("ecole_id","nom");--> statement-breakpoint
CREATE INDEX "echeance_ouvertes" ON "echeance" USING btree ("ecole_id","date_prevue") WHERE "echeance"."statut" IN ('a_venir', 'partielle', 'en_retard');--> statement-breakpoint
CREATE INDEX "facture_payeur_id_index" ON "facture" USING btree ("payeur_id");--> statement-breakpoint
CREATE INDEX "inscription_payeur_id_saison_id_index" ON "inscription" USING btree ("payeur_id","saison_id");--> statement-breakpoint
CREATE INDEX "journal_ecole_id_table_cible_ligne_id_index" ON "journal" USING btree ("ecole_id","table_cible","ligne_id");--> statement-breakpoint
CREATE INDEX "payeur_ecole_id_nom_index" ON "payeur" USING btree ("ecole_id","nom");--> statement-breakpoint
CREATE INDEX "seance_ecole_id_date_index" ON "seance" USING btree ("ecole_id","date");--> statement-breakpoint
CREATE INDEX "seance_intervenant_id_date_index" ON "seance" USING btree ("intervenant_id","date");