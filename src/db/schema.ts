/**
 * Modèle de données multi-école (SaaS) – Drizzle ORM / PostgreSQL
 *
 * Conventions
 *  - Chaque table métier porte `ecole_id` : l'isolation entre écoles est
 *    garantie par la Row Level Security (voir migrations/0001_rls.sql).
 *  - Montants en CENTIMES entiers (`*_centimes`), taux en points de base
 *    (2000 = 20 %) : aucun nombre à virgule côté TypeScript.
 *  - Le numéro de facture est fourni par l'outil de facturation de l'école.
 *  - Paiements et journal sont inaltérables (triggers dans 0001_rls.sql).
 */
import { getTableName, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Types énumérés
// ---------------------------------------------------------------------------
export const typePayeur = pgEnum("type_payeur", ["particulier", "professionnel"]);
export const typeDocument = pgEnum("type_document", [
  "certificat_medical",
  "autorisation_parentale",
  "droit_image",
  "autre",
]);
export const statutIntervenant = pgEnum("statut_intervenant", [
  "micro_entreprise",
  "societe",
  "salarie",
]);
export const regimeTva = pgEnum("regime_tva", ["franchise_293b", "assujetti", "non_applicable"]);
export const modeRemuneration = pgEnum("mode_remuneration", ["heure", "cours", "forfait_mensuel"]);
export const typeCours = pgEnum("type_cours", ["collectif", "particulier", "competition", "stage"]);
export const statutSeance = pgEnum("statut_seance", ["prevue", "effectuee", "annulee"]);
export const publicTarif = pgEnum("public_tarif", ["enfant", "adulte", "couple", "etudiant"]);
export const periodicite = pgEnum("periodicite", ["trimestre", "annee", "unite"]);
export const statutInscription = pgEnum("statut_inscription", [
  "essai",
  "liste_attente",
  "active",
  "abandon",
  "terminee",
]);
export const statutFacture = pgEnum("statut_facture", [
  "a_envoyer",
  "brouillon_outil",
  "emise",
  "rejetee",
  "annulee",
]);
export const outilFacturation = pgEnum("outil_facturation", ["pennylane", "abby", "shine"]);
export const moyenPaiement = pgEnum("moyen_paiement", [
  "cheque",
  "especes",
  "carte",
  "virement",
  "prelevement",
  "cheque_vacances",
  "pass_sport",
  "autre",
]);
export const statutEcheance = pgEnum("statut_echeance", [
  "a_venir",
  "payee",
  "partielle",
  "en_retard",
  "annulee",
]);
export const statutReleve = pgEnum("statut_releve", ["a_controler", "conforme", "ecart", "paye"]);
export const roleMembre = pgEnum("role_membre", ["direction", "accueil", "professeur"]);

// ---------------------------------------------------------------------------
// Locataire : l'école
// ---------------------------------------------------------------------------
export const ecole = pgTable("ecole", {
  id: uuid("id").primaryKey().defaultRandom(),
  nom: text("nom").notNull(),
  slug: text("slug").notNull().unique(), // sous-domaine : ribas.monapp.fr
  raisonSociale: text("raison_sociale"),
  siren: char("siren", { length: 9 }),
  regimeTva: regimeTva("regime_tva").notNull().default("non_applicable"),
  mentionTva: text("mention_tva"), // ex. « TVA non applicable, art. 293 B du CGI »
  fuseau: text("fuseau").notNull().default("Europe/Paris"),
  creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
});

/** Colonne `ecole_id` commune à toutes les tables métier. */
const ecoleId = () =>
  uuid("ecole_id")
    .notNull()
    .references(() => ecole.id, { onDelete: "cascade" });

/**
 * Clé étrangère entre deux tables métier : composite (ecole_id, colonne) vers
 * (ecole_id, id), pour que la ligne visée appartienne forcément à la même école.
 * Une clé étrangère simple ne suffit pas : sa vérification ignore la Row Level
 * Security. Colonne NULL acceptée (MATCH SIMPLE). Nom : <table>_<colonne>_meme_ecole_fk.
 */
function memeEcole(
  t: { ecoleId: AnyPgColumn },
  colonne: AnyPgColumn,
  cible: { ecoleId: AnyPgColumn; id: AnyPgColumn },
) {
  return foreignKey({
    name: `${getTableName(colonne.table)}_${colonne.name.replace(/_id$/, "")}_meme_ecole_fk`,
    columns: [t.ecoleId, colonne],
    foreignColumns: [cible.ecoleId, cible.id],
  });
}

/** Contrainte unique (ecole_id, id), cible des clés étrangères `memeEcole`. */
function cibleMemeEcole(t: { ecoleId: AnyPgColumn; id: AnyPgColumn }) {
  return unique(`${getTableName(t.id.table)}_ecole_id_id_unique`).on(t.ecoleId, t.id);
}

/** Configuration du connecteur de facturation, une par école. */
export const connecteurFacturation = pgTable("connecteur_facturation", {
  ecoleId: uuid("ecole_id")
    .primaryKey()
    .references(() => ecole.id, { onDelete: "cascade" }),
  outil: outilFacturation("outil").notNull(),
  identifiantsChiffres: text("identifiants_chiffres").notNull(), // chiffré côté application
  oneConnectActif: boolean("one_connect_actif").notNull().default(false),
  actif: boolean("actif").notNull().default(true),
  majLe: timestamp("maj_le", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Appartenance d'un utilisateur (géré par Better Auth, table `user`) à une
 * école, avec son rôle. Un même compte peut appartenir à plusieurs écoles.
 */
export const membre = pgTable(
  "membre",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    userId: text("user_id").notNull(), // id Better Auth
    role: roleMembre("role").notNull(),
    intervenantId: uuid("intervenant_id"),
    actif: boolean("actif").notNull().default(true),
  },
  (t) => [
    unique().on(t.ecoleId, t.userId),
    cibleMemeEcole(t),
    memeEcole(t, t.intervenantId, intervenant),
  ],
);

// ---------------------------------------------------------------------------
// Lieux et calendrier
// ---------------------------------------------------------------------------
export const site = pgTable(
  "site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    nom: text("nom").notNull(),
    adresse: text("adresse").notNull(),
    permanence: boolean("permanence").notNull().default(false),
  },
  (t) => [cibleMemeEcole(t)],
);

export const salle = pgTable(
  "salle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    siteId: uuid("site_id").notNull(),
    nom: text("nom").notNull(),
    capacite: integer("capacite"),
  },
  (t) => [cibleMemeEcole(t), memeEcole(t, t.siteId, site)],
);

export const saison = pgTable(
  "saison",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    libelle: text("libelle").notNull(), // '2027-2028'
    dateDebut: date("date_debut").notNull(),
    dateFin: date("date_fin").notNull(),
  },
  (t) => [
    unique().on(t.ecoleId, t.libelle),
    check("saison_dates", sql`${t.dateFin} > ${t.dateDebut}`),
    cibleMemeEcole(t),
  ],
);

export const fermeture = pgTable(
  "fermeture",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("saison_id").notNull(),
    libelle: text("libelle").notNull(),
    debut: date("debut").notNull(),
    fin: date("fin").notNull(),
  },
  (t) => [memeEcole(t, t.saisonId, saison)],
);

// ---------------------------------------------------------------------------
// Familles et danseurs
// ---------------------------------------------------------------------------
export const payeur = pgTable(
  "payeur",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    type: typePayeur("type").notNull().default("particulier"),
    nom: text("nom").notNull(),
    prenom: text("prenom"),
    raisonSociale: text("raison_sociale"),
    siren: char("siren", { length: 9 }),
    email: text("email"),
    telephone: text("telephone"),
    adresse: text("adresse"),
    refOutil: text("ref_outil"), // id du client dans l'outil de facturation
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("payeur_pro_siren", sql`${t.type} = 'particulier' OR ${t.siren} IS NOT NULL`),
    index().on(t.ecoleId, t.nom),
    cibleMemeEcole(t),
  ],
);

export const danseur = pgTable(
  "danseur",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    payeurId: uuid("payeur_id").notNull(),
    nom: text("nom").notNull(),
    prenom: text("prenom").notNull(),
    dateNaissance: date("date_naissance"),
    contactUrgence: text("contact_urgence"),
    telephoneUrgence: text("telephone_urgence"),
    notes: text("notes"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.payeurId),
    index().on(t.ecoleId, t.nom),
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, payeur),
  ],
);

export const documentDanseur = pgTable(
  "document_danseur",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    danseurId: uuid("danseur_id").notNull(),
    type: typeDocument("type").notNull(),
    accorde: boolean("accorde").notNull().default(true),
    valideJusqu: date("valide_jusqu"),
    fichier: text("fichier"),
  },
  (t) => [memeEcole(t, t.danseurId, danseur)],
);

// ---------------------------------------------------------------------------
// Professeurs
// ---------------------------------------------------------------------------
export const intervenant = pgTable(
  "intervenant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    nom: text("nom").notNull(),
    prenom: text("prenom").notNull(),
    email: text("email"),
    statut: statutIntervenant("statut").notNull(),
    siren: char("siren", { length: 9 }),
    regimeTva: regimeTva("regime_tva").notNull(),
    estDirigeant: boolean("est_dirigeant").notNull().default(false),
    modeRemuneration: modeRemuneration("mode_remuneration").notNull(),
    tarifCentimes: integer("tarif_centimes").notNull(), // par heure, cours ou mois
    actif: boolean("actif").notNull().default(true),
  },
  (t) => [cibleMemeEcole(t)],
);

// ---------------------------------------------------------------------------
// Offre et planning
// ---------------------------------------------------------------------------
export const discipline = pgTable(
  "discipline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    nom: text("nom").notNull(),
  },
  (t) => [
    unique().on(t.ecoleId, t.nom),
    cibleMemeEcole(t),
  ],
);

export const cours = pgTable(
  "cours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("saison_id").notNull(),
    disciplineId: uuid("discipline_id").notNull(),
    salleId: uuid("salle_id").notNull(),
    intervenantId: uuid("intervenant_id").notNull(),
    type: typeCours("type").notNull().default("collectif"),
    niveau: text("niveau"),
    ageMin: smallint("age_min"),
    ageMax: smallint("age_max"),
    jourSemaine: smallint("jour_semaine"), // 1 = lundi ; NULL pour un stage
    heureDebut: time("heure_debut").notNull(),
    dureeMinutes: integer("duree_minutes").notNull(),
    capaciteMax: integer("capacite_max"),
  },
  (t) => [
    check("cours_jour", sql`${t.jourSemaine} BETWEEN 1 AND 7`),
    check("cours_duree", sql`${t.dureeMinutes} > 0`),
    index().on(t.saisonId, t.jourSemaine),
    cibleMemeEcole(t),
    memeEcole(t, t.saisonId, saison),
    memeEcole(t, t.disciplineId, discipline),
    memeEcole(t, t.salleId, salle),
    memeEcole(t, t.intervenantId, intervenant),
  ],
);

export const seance = pgTable(
  "seance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    coursId: uuid("cours_id").notNull(),
    date: date("date").notNull(),
    statut: statutSeance("statut").notNull().default("prevue"),
    intervenantId: uuid("intervenant_id").notNull(), // remplaçant possible
  },
  (t) => [
    unique().on(t.coursId, t.date),
    index().on(t.ecoleId, t.date),
    index().on(t.intervenantId, t.date),
    cibleMemeEcole(t),
    memeEcole(t, t.coursId, cours),
    memeEcole(t, t.intervenantId, intervenant),
  ],
);

export const presence = pgTable(
  "presence",
  {
    ecoleId: ecoleId(),
    seanceId: uuid("seance_id").notNull(),
    danseurId: uuid("danseur_id").notNull(),
    present: boolean("present").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seanceId, t.danseurId] }),
    memeEcole(t, t.seanceId, seance),
    memeEcole(t, t.danseurId, danseur),
  ],
);

// ---------------------------------------------------------------------------
// Tarifs et réductions
// ---------------------------------------------------------------------------
/** Une ligne par case de la grille : public × périodicité × combinaison de cours (× discipline). */
export const tarif = pgTable(
  "tarif",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("saison_id").notNull(),
    public: publicTarif("public").notNull(),
    periodicite: periodicite("periodicite").notNull(),
    // Durées des cours de la semaine, en minutes, triées : {45,45,60} = « 45 min + 45 min + 1 h 00 ».
    combinaison: smallint("combinaison").array().notNull(),
    // Forfait réservé à une discipline (ex. « Zumba 2 h 00 ») ; NULL = toutes disciplines.
    disciplineId: uuid("discipline_id"),
    prixCentimes: integer("prix_centimes").notNull(),
  },
  (t) => [
    // NULLS NOT DISTINCT : deux lignes « toutes disciplines » identiques sont refusées.
    unique("tarif_case_unique")
      .on(t.saisonId, t.public, t.periodicite, t.combinaison, t.disciplineId)
      .nullsNotDistinct(),
    check("tarif_combinaison", sql`cardinality(${t.combinaison}) >= 1 AND 0 < ALL(${t.combinaison})`),
    cibleMemeEcole(t),
    memeEcole(t, t.saisonId, saison),
    memeEcole(t, t.disciplineId, discipline),
  ],
);

export const reduction = pgTable(
  "reduction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("saison_id").notNull(),
    code: text("code").notNull(), // type de réduction connu du moteur de tarif : 'fratrie'
    tauxPointsBase: integer("taux_points_base"), // 1000 = 10 %
    montantCentimes: integer("montant_centimes"),
    nonCumulableAvec: text("non_cumulable_avec").array().notNull().default(sql`'{}'::text[]`),
    // Nombre minimal de danseurs éligibles du même payeur (fratrie : 2).
    seuilDanseurs: smallint("seuil_danseurs").notNull().default(1),
    // Publics éligibles ; vide = tous.
    publics: publicTarif("publics").array().notNull().default(sql`'{}'::public_tarif[]`),
    // false : écartée sur un forfait dont les cours relèvent d'au moins 2 disciplines.
    cumulableMultiDisciplines: boolean("cumulable_multi_disciplines").notNull().default(true),
  },
  (t) => [
    unique().on(t.saisonId, t.code),
    check(
      "reduction_valeur",
      sql`${t.tauxPointsBase} IS NOT NULL OR ${t.montantCentimes} IS NOT NULL`,
    ),
    memeEcole(t, t.saisonId, saison),
  ],
);

// ---------------------------------------------------------------------------
// Inscriptions
// ---------------------------------------------------------------------------
/** Un forfait payé par un payeur ; peut couvrir deux danseurs (tarif couple). */
export const inscription = pgTable(
  "inscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    payeurId: uuid("payeur_id").notNull(),
    saisonId: uuid("saison_id").notNull(),
    tarifId: uuid("tarif_id"),
    statut: statutInscription("statut").notNull().default("active"),
    dateInscription: date("date_inscription").notNull().defaultNow(),
    prixBrutCentimes: integer("prix_brut_centimes").notNull(),
    remiseCentimes: integer("remise_centimes").notNull().default(0),
    prixNetCentimes: integer("prix_net_centimes").generatedAlwaysAs(
      sql`prix_brut_centimes - remise_centimes`,
    ),
    reductions: text("reductions").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    index().on(t.payeurId, t.saisonId),
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, payeur),
    memeEcole(t, t.saisonId, saison),
    memeEcole(t, t.tarifId, tarif),
  ],
);

export const inscriptionCours = pgTable(
  "inscription_cours",
  {
    ecoleId: ecoleId(),
    inscriptionId: uuid("inscription_id").notNull(),
    danseurId: uuid("danseur_id").notNull(),
    coursId: uuid("cours_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.inscriptionId, t.danseurId, t.coursId] }),
    memeEcole(t, t.inscriptionId, inscription),
    memeEcole(t, t.danseurId, danseur),
    memeEcole(t, t.coursId, cours),
  ],
);

/** Cours particuliers : carnets de 1, 5 ou 10 séances, pour 1 à 4 personnes. */
export const carnet = pgTable(
  "carnet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    payeurId: uuid("payeur_id").notNull(),
    nbPersonnes: smallint("nb_personnes").notNull(),
    seancesTotal: smallint("seances_total").notNull(),
    prixCentimes: integer("prix_centimes").notNull(),
    acheteLe: date("achete_le").notNull().defaultNow(),
  },
  (t) => [
    check("carnet_personnes", sql`${t.nbPersonnes} BETWEEN 1 AND 4`),
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, payeur),
  ],
);

export const carnetUtilisation = pgTable(
  "carnet_utilisation",
  {
    ecoleId: ecoleId(),
    carnetId: uuid("carnet_id").notNull(),
    seanceId: uuid("seance_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.carnetId, t.seanceId] }),
    memeEcole(t, t.carnetId, carnet),
    memeEcole(t, t.seanceId, seance),
  ],
);

// ---------------------------------------------------------------------------
// Facturation et encaissements
// ---------------------------------------------------------------------------
export const facture = pgTable(
  "facture",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    payeurId: uuid("payeur_id").notNull(),
    statut: statutFacture("statut").notNull().default("a_envoyer"),
    outil: outilFacturation("outil"),
    refOutil: text("ref_outil"),
    numero: text("numero"), // renvoyé par l'outil, jamais saisi ici
    dateEmission: date("date_emission"),
    totalHtCentimes: integer("total_ht_centimes").notNull().default(0),
    totalTvaCentimes: integer("total_tva_centimes").notNull().default(0),
    totalTtcCentimes: integer("total_ttc_centimes").notNull().default(0),
    avoirDe: uuid("avoir_de"),
    pdfUrl: text("pdf_url"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.ecoleId, t.numero),
    index().on(t.payeurId),
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, payeur),
    memeEcole(t, t.avoirDe, t),
  ],
);

export const ligneFacture = pgTable(
  "ligne_facture",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    factureId: uuid("facture_id").notNull(),
    libelle: text("libelle").notNull(),
    quantiteMilliemes: integer("quantite_milliemes").notNull().default(1000), // 1000 = 1
    prixUnitaireCentimes: integer("prix_unitaire_centimes").notNull(),
    tauxTvaPointsBase: integer("taux_tva_points_base").notNull().default(0), // 2000 = 20 %
    inscriptionId: uuid("inscription_id"),
    carnetId: uuid("carnet_id"), // NULL : stage, location, billet…
  },
  (t) => [
    memeEcole(t, t.factureId, facture),
    memeEcole(t, t.inscriptionId, inscription),
    memeEcole(t, t.carnetId, carnet),
  ],
);

export const echeance = pgTable(
  "echeance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    factureId: uuid("facture_id").notNull(),
    rang: smallint("rang").notNull(),
    datePrevue: date("date_prevue").notNull(),
    montantCentimes: integer("montant_centimes").notNull(),
    statut: statutEcheance("statut").notNull().default("a_venir"),
  },
  (t) => [
    unique().on(t.factureId, t.rang),
    index("echeance_ouvertes")
      .on(t.ecoleId, t.datePrevue)
      .where(sql`${t.statut} IN ('a_venir', 'partielle', 'en_retard')`),
    cibleMemeEcole(t),
    memeEcole(t, t.factureId, facture),
  ],
);

/** Inaltérable : une erreur ou un remboursement = un paiement négatif. */
export const paiement = pgTable(
  "paiement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    payeurId: uuid("payeur_id").notNull(),
    date: date("date").notNull().defaultNow(),
    montantCentimes: integer("montant_centimes").notNull(),
    moyen: moyenPaiement("moyen").notNull(),
    reference: text("reference"),
    saisiPar: uuid("saisi_par"),
    synchroOutil: boolean("synchro_outil").notNull().default(false),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, payeur),
    memeEcole(t, t.saisiPar, membre),
  ],
);

export const affectationPaiement = pgTable(
  "affectation_paiement",
  {
    ecoleId: ecoleId(),
    paiementId: uuid("paiement_id").notNull(),
    echeanceId: uuid("echeance_id").notNull(),
    montantCentimes: integer("montant_centimes").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paiementId, t.echeanceId] }),
    memeEcole(t, t.paiementId, paiement),
    memeEcole(t, t.echeanceId, echeance),
  ],
);

// ---------------------------------------------------------------------------
// Rémunération des professeurs
// ---------------------------------------------------------------------------
export const releveIntervenant = pgTable(
  "releve_intervenant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    intervenantId: uuid("intervenant_id").notNull(),
    mois: date("mois").notNull(), // 1er jour du mois
    nbSeances: integer("nb_seances").notNull(),
    minutes: integer("minutes").notNull(),
    montantDuCentimes: integer("montant_du_centimes").notNull(),
    factureRecue: text("facture_recue"),
    montantFactureCentimes: integer("montant_facture_centimes"),
    statut: statutReleve("statut").notNull().default("a_controler"),
  },
  (t) => [unique().on(t.intervenantId, t.mois), memeEcole(t, t.intervenantId, intervenant)],
);

// ---------------------------------------------------------------------------
// Journal d'audit (append-only)
// ---------------------------------------------------------------------------
export const journal = pgTable(
  "journal",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ecoleId: ecoleId(),
    quand: timestamp("quand", { withTimezone: true }).notNull().defaultNow(),
    qui: uuid("qui"),
    tableCible: text("table_cible").notNull(),
    ligneId: uuid("ligne_id").notNull(),
    action: text("action").notNull(), // insert | update | delete
    avant: jsonb("avant"),
    apres: jsonb("apres"),
  },
  (t) => [index().on(t.ecoleId, t.tableCible, t.ligneId), memeEcole(t, t.qui, membre)],
);
