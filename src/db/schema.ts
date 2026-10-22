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
export const typePersonne = pgEnum("type_personne", ["particulier", "professionnel"]);
export const typeLien = pgEnum("type_lien", ["representant_legal", "conjoint", "autre"]);
export const typeDocument = pgEnum("type_document", [
  "certificat_medical",
  "autorisation_parentale",
  "droit_image",
  "autre",
]);
export const statutIntervenant = pgEnum("statut_intervenant", ["micro_entreprise", "societe", "salarie"]);
export const regimeTva = pgEnum("regime_tva", ["franchise_293b", "assujetti", "non_applicable"]);
export const modeRemuneration = pgEnum("mode_remuneration", ["heure", "cours", "forfait_mensuel"]);
export const typeCours = pgEnum("type_cours", ["collectif", "particulier", "competition", "stage"]);
export const statutSeance = pgEnum("statut_seance", ["prevue", "effectuee", "annulee"]);
/** Chaque semaine, une semaine sur deux, ou à des dates précises (#90). */
export const recurrenceCours = pgEnum("recurrence_cours", ["hebdomadaire", "quinzaine", "dates"]);
export const origineIndisponibilite = pgEnum("origine_indisponibilite", ["saisie", "google", "microsoft"]);
export const fournisseurAgenda = pgEnum("fournisseur_agenda", ["google", "microsoft"]);
export const publicTarif = pgEnum("public_tarif", ["enfant", "adulte", "couple", "etudiant"]);
export const periodicite = pgEnum("periodicite", ["trimestre", "annee", "unite"]);
export const statutInscription = pgEnum("statut_inscription", [
  "essai",
  "liste_attente",
  "active",
  "abandon",
  "terminee",
]);
export const statutFacture = pgEnum("statut_facture", ["a_envoyer", "brouillon_outil", "emise", "rejetee", "annulee"]);
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
export const statutEcheance = pgEnum("statut_echeance", ["a_venir", "payee", "partielle", "en_retard", "annulee"]);
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
    userId: text("user_id")
      .notNull()
      .references((): AnyPgColumn => user.id), // compte Better Auth (global, toutes écoles)
    role: roleMembre("role").notNull(),
    intervenantId: uuid("intervenant_id"),
    actif: boolean("actif").notNull().default(true),
  },
  (t) => [unique().on(t.ecoleId, t.userId), cibleMemeEcole(t), memeEcole(t, t.intervenantId, intervenant)],
);

/** Lien envoyé à une personne : rejoindre l'équipe, ou choisir un nouveau mot de passe (#104). */
export const typeInvitation = pgEnum("type_invitation", ["invitation", "reinitialisation"]);

/**
 * Invitation dans l'équipe d'une école, ou réinitialisation du mot de passe
 * d'un membre (#104). Le jeton n'est montré qu'une fois, dans le lien ; seule
 * son empreinte est gardée. Usage unique, durée limitée.
 */
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    type: typeInvitation("type").notNull(),
    email: text("email").notNull(),
    nom: text("nom"),
    role: roleMembre("role"), // invitation : rôle donné en rejoignant l'école
    userId: text("user_id").references((): AnyPgColumn => user.id, { onDelete: "cascade" }), // réinitialisation : compte visé
    jetonHash: text("jeton_hash").notNull().unique(),
    expireLe: timestamp("expire_le", { withTimezone: true }).notNull(),
    creePar: uuid("cree_par"),
    utiliseLe: timestamp("utilise_le", { withTimezone: true }),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "invitation_contenu",
      sql`(${t.type} = 'invitation' AND ${t.role} IS NOT NULL) OR (${t.type} = 'reinitialisation' AND ${t.userId} IS NOT NULL)`,
    ),
    memeEcole(t, t.creePar, membre),
  ],
);

/**
 * Disposition des colonnes d'une liste (élèves, contacts…) propre à chaque
 * membre (#89) : identifiants des colonnes affichées, dans l'ordre. Une simple
 * préférence d'affichage, supprimée avec le membre.
 */
export const preferenceListe = pgTable(
  "preference_liste",
  {
    ecoleId: ecoleId(),
    membreId: uuid("membre_id").notNull(),
    liste: text("liste").notNull(),
    colonnes: text("colonnes").array().notNull(),
    modifieLe: timestamp("modifie_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.membreId, t.liste] }), memeEcole(t, t.membreId, membre).onDelete("cascade")],
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

/**
 * Jours et heures d'ouverture d'un site (#90) : un jour absent est fermé. Un
 * site sans aucun horaire saisi n'impose rien (le planning reste libre).
 */
export const horaireSite = pgTable(
  "horaire_site",
  {
    ecoleId: ecoleId(),
    siteId: uuid("site_id").notNull(),
    jourSemaine: smallint("jour_semaine").notNull(), // 1 = lundi … 7 = dimanche
    ouverture: time("ouverture").notNull(),
    fermeture: time("fermeture").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.jourSemaine] }),
    check("horaire_site_jour", sql`${t.jourSemaine} BETWEEN 1 AND 7`),
    check("horaire_site_ordre", sql`${t.fermeture} > ${t.ouverture}`),
    memeEcole(t, t.siteId, site).onDelete("cascade"),
  ],
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
// Personnes et liens (plus de « famille » : voir #67)
// ---------------------------------------------------------------------------
/**
 * Toute personne connue de l'école : danseur, parent, conjoint, contact
 * d'urgence, ou payeur professionnel (entreprise, CSE). Un adulte seul est à la
 * fois danseur et payeur : pas de « famille » à créer.
 */
export const personne = pgTable(
  "personne",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    type: typePersonne("type").notNull().default("particulier"),
    nom: text("nom").notNull(),
    prenom: text("prenom"),
    raisonSociale: text("raison_sociale"),
    siren: char("siren", { length: 9 }),
    dateNaissance: date("date_naissance"),
    email: text("email"),
    telephone: text("telephone"),
    adresse: text("adresse"),
    notes: text("notes"), // santé, consignes : visibles par l'accueil et la direction
    // Élève de l'école (danseur) ; sinon contact : parent, payeur, organisme.
    eleve: boolean("eleve").notNull().default(false),
    refOutil: text("ref_outil"), // id du client dans l'outil de facturation
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("personne_pro_siren", sql`${t.type} = 'particulier' OR ${t.siren} IS NOT NULL`),
    index().on(t.ecoleId, t.nom),
    cibleMemeEcole(t),
  ],
);

/**
 * Lien orienté : `personne` est <type> de `lie_a` (Hélène, représentante
 * légale de Zoé). Un conjoint n'est enregistré qu'une fois, dans un sens.
 */
export const lien = pgTable(
  "lien",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    personneId: uuid("personne_id").notNull(),
    lieAId: uuid("lie_a_id").notNull(),
    type: typeLien("type").notNull(),
    contactUrgence: boolean("contact_urgence").notNull().default(false),
    paiePour: boolean("paie_pour").notNull().default(false),
  },
  (t) => [
    unique().on(t.personneId, t.lieAId),
    check("lien_distinct", sql`${t.personneId} <> ${t.lieAId}`),
    index().on(t.lieAId),
    memeEcole(t, t.personneId, personne),
    memeEcole(t, t.lieAId, personne),
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
  (t) => [memeEcole(t, t.danseurId, personne)],
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
    // Abonnement à l'agenda : seule l'empreinte SHA-256 du jeton est gardée.
    jetonAgendaHash: text("jeton_agenda_hash").unique(),
    jetonAgendaCreeLe: timestamp("jeton_agenda_cree_le", { withTimezone: true }),
  },
  (t) => [cibleMemeEcole(t)],
);

/**
 * Plage où un intervenant n'est pas disponible : saisie par la direction, ou
 * lue dans son agenda (plage occupée seulement, jamais le contenu).
 */
export const indisponibilite = pgTable(
  "indisponibilite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    intervenantId: uuid("intervenant_id").notNull(),
    debut: timestamp("debut", { withTimezone: true }).notNull(),
    fin: timestamp("fin", { withTimezone: true }).notNull(),
    origine: origineIndisponibilite("origine").notNull().default("saisie"),
    libelle: text("libelle"), // saisie seulement
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("indisponibilite_fin", sql`${t.fin} > ${t.debut}`),
    index().on(t.intervenantId, t.debut),
    memeEcole(t, t.intervenantId, intervenant),
  ],
);

/**
 * Agenda Google ou Microsoft connecté par un intervenant : jeton de
 * rafraîchissement chiffré (src/lib/chiffrement.ts), jamais en clair.
 */
export const connexionAgenda = pgTable(
  "connexion_agenda",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    intervenantId: uuid("intervenant_id").notNull(),
    fournisseur: fournisseurAgenda("fournisseur").notNull(),
    compte: text("compte"),
    jetonChiffre: text("jeton_chiffre").notNull(),
    derniereSynchro: timestamp("derniere_synchro", { withTimezone: true }),
    erreur: text("erreur"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.intervenantId), memeEcole(t, t.intervenantId, intervenant)],
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
  (t) => [unique().on(t.ecoleId, t.nom), cibleMemeEcole(t)],
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
    recurrence: recurrenceCours("recurrence").notNull().default("hebdomadaire"),
    jourSemaine: smallint("jour_semaine"), // 1 = lundi ; NULL pour des dates précises (table cours_date)
    // Période limitée d'un cours régulier dans la saison ; NULL : depuis le début, jusqu'à la fin.
    dateDebut: date("date_debut"),
    dateFin: date("date_fin"),
    heureDebut: time("heure_debut").notNull(),
    dureeMinutes: integer("duree_minutes").notNull(),
    capaciteMax: integer("capacite_max"),
  },
  (t) => [
    check("cours_jour", sql`${t.jourSemaine} BETWEEN 1 AND 7`),
    check("cours_recurrence_jour", sql`(${t.recurrence} = 'dates') = (${t.jourSemaine} IS NULL)`),
    check("cours_periode", sql`${t.dateDebut} IS NULL OR ${t.dateFin} IS NULL OR ${t.dateDebut} <= ${t.dateFin}`),
    check("cours_duree", sql`${t.dureeMinutes} > 0`),
    index().on(t.saisonId, t.jourSemaine),
    cibleMemeEcole(t),
    memeEcole(t, t.saisonId, saison),
    memeEcole(t, t.disciplineId, discipline),
    memeEcole(t, t.salleId, salle),
    memeEcole(t, t.intervenantId, intervenant),
  ],
);

/** Dates d'un cours ponctuel (récurrence « dates » : stage, cours exceptionnel). */
export const coursDate = pgTable(
  "cours_date",
  {
    ecoleId: ecoleId(),
    coursId: uuid("cours_id").notNull(),
    date: date("date").notNull(),
  },
  (t) => [primaryKey({ columns: [t.coursId, t.date] }), memeEcole(t, t.coursId, cours).onDelete("cascade")],
);

export const seance = pgTable(
  "seance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    coursId: uuid("cours_id").notNull(),
    date: date("date").notNull(),
    // Séance déplacée (#90) : sa date d'origine, qui sert de repère à la génération des séances.
    datePrevue: date("date_prevue"),
    // Heure et durée propres à la séance (déplacée, ou figée avant un changement de créneau) ; NULL : celles du cours.
    heureDebut: time("heure_debut"),
    dureeMinutes: integer("duree_minutes"),
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
    memeEcole(t, t.danseurId, personne),
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
    nonCumulableAvec: text("non_cumulable_avec")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Nombre minimal de danseurs éligibles du même payeur (fratrie : 2).
    seuilDanseurs: smallint("seuil_danseurs").notNull().default(1),
    // Publics éligibles ; vide = tous.
    publics: publicTarif("publics")
      .array()
      .notNull()
      .default(sql`'{}'::public_tarif[]`),
    // false : écartée sur un forfait dont les cours relèvent d'au moins 2 disciplines.
    cumulableMultiDisciplines: boolean("cumulable_multi_disciplines").notNull().default(true),
  },
  (t) => [
    unique().on(t.saisonId, t.code),
    check("reduction_valeur", sql`${t.tauxPointsBase} IS NOT NULL OR ${t.montantCentimes} IS NOT NULL`),
    memeEcole(t, t.saisonId, saison),
  ],
);

/**
 * Grille des carnets de cours particuliers : une ligne par nombre de séances
 * et tranche de personnes (« jusqu'à personnes_max »). Au-delà de la dernière
 * tranche : devis, prix saisi sur le carnet.
 */
export const tarifCarnet = pgTable(
  "tarif_carnet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("saison_id").notNull(),
    nbSeances: smallint("nb_seances").notNull(),
    personnesMax: smallint("personnes_max").notNull(),
    prixCentimes: integer("prix_centimes").notNull(),
  },
  (t) => [
    unique("tarif_carnet_case_unique").on(t.saisonId, t.nbSeances, t.personnesMax),
    check("tarif_carnet_valeurs", sql`${t.nbSeances} >= 1 AND ${t.personnesMax} >= 1 AND ${t.prixCentimes} >= 0`),
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
    // Public et périodicité choisis : nécessaires pour recalculer la fratrie
    // avec les inscriptions existantes, même sans tarif retenu (prix manuel).
    public: publicTarif("public").notNull(),
    periodicite: periodicite("periodicite").notNull(),
    statut: statutInscription("statut").notNull().default("active"),
    dateInscription: date("date_inscription").notNull().defaultNow(),
    prixBrutCentimes: integer("prix_brut_centimes").notNull(),
    remiseCentimes: integer("remise_centimes").notNull().default(0),
    prixNetCentimes: integer("prix_net_centimes").generatedAlwaysAs(sql`prix_brut_centimes - remise_centimes`),
    reductions: text("reductions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.payeurId, t.saisonId),
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, personne),
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
    memeEcole(t, t.danseurId, personne),
    memeEcole(t, t.coursId, cours),
  ],
);

/**
 * Cours particuliers : un carnet acheté, prix figé à l'achat (grille `tarif_carnet`
 * ou devis). Nombres de séances et de personnes : données de l'école, pas de limite ici.
 */
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
    check("carnet_personnes", sql`${t.nbPersonnes} >= 1 AND ${t.seancesTotal} >= 1`),
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, personne),
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
    memeEcole(t, t.payeurId, personne),
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
    reference: text("reference"), // numéro de chèque, d'autorisation…
    // Banque ou titulaire d'un chèque quand ce n'est pas le payeur (#97).
    emetteur: text("emetteur"),
    // Chèque à encaisser plus tard (remis à l'inscription, encaissé au trimestre) ; NULL : tout de suite.
    encaissementPrevu: date("encaissement_prevu"),
    // Correction : paiement négatif qui annule tout ou partie de ce paiement-ci.
    corrigeId: uuid("corrige_id"),
    saisiPar: uuid("saisi_par"),
    synchroOutil: boolean("synchro_outil").notNull().default(false),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("paiement_montant", sql`${t.montantCentimes} <> 0`),
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, personne),
    memeEcole(t, t.saisiPar, membre),
    memeEcole(t, t.corrigeId, t),
  ],
);

/** Moyens remis à la banque (ou à l'ANCV) par bordereau (#98). */
export const moyenRemise = pgEnum("moyen_remise", ["cheque", "especes", "cheque_vacances"]);

/** Remise en banque : un bordereau de chèques, d'espèces ou de chèques vacances déposés ensemble (#98). */
export const remise = pgTable(
  "remise",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    date: date("date").notNull(),
    moyen: moyenRemise("moyen").notNull(),
    creePar: uuid("cree_par"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [cibleMemeEcole(t), memeEcole(t, t.creePar, membre)],
);

/** Paiements d'une remise ; un paiement ne figure que dans une seule remise (le paiement, inaltérable, n'est pas modifié). */
export const remisePaiement = pgTable(
  "remise_paiement",
  {
    ecoleId: ecoleId(),
    remiseId: uuid("remise_id").notNull(),
    paiementId: uuid("paiement_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paiementId] }),
    index().on(t.remiseId),
    memeEcole(t, t.remiseId, remise).onDelete("cascade"),
    memeEcole(t, t.paiementId, paiement),
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

// ---------------------------------------------------------------------------
// Authentification (Better Auth) : tables GLOBALES, sans ecole_id ni RLS.
// Un compte peut appartenir à plusieurs écoles (`membre`). Structure attendue
// par Better Auth 1.7 (getAuthTables) ; propriétés en camelCase, colonnes en snake_case.
// ---------------------------------------------------------------------------
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // École choisie après connexion, fixée côté serveur après vérification de
    // l'appartenance. Pas nommée ecole_id : la session n'est pas une donnée d'école.
    ecoleChoisie: uuid("ecole_choisie").references(() => ecole.id, { onDelete: "set null" }),
  },
  (t) => [index().on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"), // haché par Better Auth
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId)],
);

/**
 * Échecs de connexion récents, pour limiter les essais de mots de passe
 * (src/lib/limite-connexion.ts). La clé est un HMAC de l'e-mail ou de l'IP :
 * aucune donnée personnelle en clair. Purgée au fil de l'eau.
 */
export const tentativeConnexion = pgTable(
  "tentative_connexion",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cle: text("cle").notNull(),
    quand: timestamp("quand", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.cle, t.quand)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
