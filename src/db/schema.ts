/**
 * Modèle de données multi-école (SaaS) – Drizzle ORM / PostgreSQL
 *
 * Conventions
 *  - Chaque table métier porte `school_id` : l'isolation entre écoles est
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
export const typePersonne = pgEnum("person_type", ["particulier", "professionnel"]);
export const typeLien = pgEnum("relationship_type", ["representant_legal", "conjoint", "autre"]);
export const typeDocument = pgEnum("document_type", [
  "certificat_medical",
  "autorisation_parentale",
  "droit_image",
  "autre",
]);
export const statutIntervenant = pgEnum("instructor_status", ["micro_entreprise", "societe", "salarie"]);
export const regimeTva = pgEnum("vat_regime", ["franchise_293b", "assujetti", "non_applicable"]);
export const modeRemuneration = pgEnum("pay_mode", ["heure", "cours", "forfait_mensuel"]);
export const typeCours = pgEnum("course_type", ["collectif", "particulier", "competition", "stage"]);
export const statutSeance = pgEnum("lesson_status", ["prevue", "effectuee", "annulee"]);
/** Chaque semaine, une semaine sur deux, ou à des dates précises (#90). */
export const recurrenceCours = pgEnum("course_recurrence", ["hebdomadaire", "quinzaine", "dates"]);
export const origineIndisponibilite = pgEnum("unavailability_source", ["saisie", "google", "microsoft"]);
export const fournisseurAgenda = pgEnum("calendar_provider", ["google", "microsoft"]);
export const publicTarif = pgEnum("tariff_audience", ["enfant", "adulte", "couple", "etudiant"]);
export const periodicite = pgEnum("period", ["trimestre", "annee", "unite"]);
export const statutInscription = pgEnum("enrollment_status", [
  "essai",
  "liste_attente",
  "active",
  "abandon",
  "terminee",
]);
export const statutFacture = pgEnum("invoice_status", ["a_envoyer", "brouillon_outil", "emise", "rejetee", "annulee"]);
export const outilFacturation = pgEnum("invoicing_tool", ["pennylane", "abby", "shine"]);
export const moyenPaiement = pgEnum("payment_method", [
  "cheque",
  "especes",
  "carte",
  "virement",
  "prelevement",
  "cheque_vacances",
  "pass_sport",
  "autre",
]);
export const statutEcheance = pgEnum("installment_status", ["a_venir", "payee", "partielle", "en_retard", "annulee"]);
export const statutReleve = pgEnum("statement_status", ["a_controler", "conforme", "ecart", "paye"]);
export const roleMembre = pgEnum("member_role", ["direction", "accueil", "professeur"]);

// ---------------------------------------------------------------------------
// Locataire : l'école
// ---------------------------------------------------------------------------
export const ecole = pgTable("school", {
  id: uuid("id").primaryKey().defaultRandom(),
  nom: text("name").notNull(),
  slug: text("slug").notNull().unique(), // sous-domaine : ribas.monapp.fr
  raisonSociale: text("company_name"),
  siren: char("siren", { length: 9 }),
  regimeTva: regimeTva("vat_regime").notNull().default("non_applicable"),
  mentionTva: text("vat_mention"), // ex. « TVA non applicable, art. 293 B du CGI »
  fuseau: text("time_zone").notNull().default("Europe/Paris"),
  creeLe: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Colonne `school_id` commune à toutes les tables métier. */
const ecoleId = () =>
  uuid("school_id")
    .notNull()
    .references(() => ecole.id, { onDelete: "cascade" });

/**
 * Clé étrangère entre deux tables métier : composite (school_id, colonne) vers
 * (school_id, id), pour que la ligne visée appartienne forcément à la même école.
 * Une clé étrangère simple ne suffit pas : sa vérification ignore la Row Level
 * Security. Colonne NULL acceptée (MATCH SIMPLE). Nom : <table>_<colonne>_same_school_fk.
 */
function memeEcole(
  t: { ecoleId: AnyPgColumn },
  colonne: AnyPgColumn,
  cible: { ecoleId: AnyPgColumn; id: AnyPgColumn },
) {
  return foreignKey({
    name: `${getTableName(colonne.table)}_${colonne.name.replace(/_id$/, "")}_same_school_fk`,
    columns: [t.ecoleId, colonne],
    foreignColumns: [cible.ecoleId, cible.id],
  });
}

/** Contrainte unique (school_id, id), cible des clés étrangères `memeEcole`. */
function cibleMemeEcole(t: { ecoleId: AnyPgColumn; id: AnyPgColumn }) {
  return unique(`${getTableName(t.id.table)}_school_id_id_unique`).on(t.ecoleId, t.id);
}

/** Configuration du connecteur de facturation, une par école. */
export const connecteurFacturation = pgTable("invoicing_connector", {
  ecoleId: uuid("school_id")
    .primaryKey()
    .references(() => ecole.id, { onDelete: "cascade" }),
  outil: outilFacturation("tool").notNull(),
  identifiantsChiffres: text("encrypted_credentials").notNull(), // chiffré côté application
  oneConnectActif: boolean("one_connect_enabled").notNull().default(false),
  actif: boolean("active").notNull().default(true),
  majLe: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Appartenance d'un utilisateur (géré par Better Auth, table `user`) à une
 * école, avec son rôle. Un même compte peut appartenir à plusieurs écoles.
 */
export const membre = pgTable(
  "member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    userId: text("user_id")
      .notNull()
      .references((): AnyPgColumn => user.id), // compte Better Auth (global, toutes écoles)
    role: roleMembre("role").notNull(),
    intervenantId: uuid("instructor_id"),
    actif: boolean("active").notNull().default(true),
  },
  (t) => [unique().on(t.ecoleId, t.userId), cibleMemeEcole(t), memeEcole(t, t.intervenantId, intervenant)],
);

/** Lien envoyé à une personne : rejoindre l'équipe, ou choisir un nouveau mot de passe (#104). */
export const typeInvitation = pgEnum("invitation_type", ["invitation", "reinitialisation"]);

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
    nom: text("name"),
    role: roleMembre("role"), // invitation : rôle donné en rejoignant l'école
    userId: text("user_id").references((): AnyPgColumn => user.id, { onDelete: "cascade" }), // réinitialisation : compte visé
    jetonHash: text("token_hash").notNull().unique(),
    expireLe: timestamp("expires_at", { withTimezone: true }).notNull(),
    creePar: uuid("created_by"),
    utiliseLe: timestamp("used_at", { withTimezone: true }),
    creeLe: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "invitation_content",
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
  "list_preference",
  {
    ecoleId: ecoleId(),
    membreId: uuid("member_id").notNull(),
    liste: text("list").notNull(),
    colonnes: text("columns").array().notNull(),
    modifieLe: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    nom: text("name").notNull(),
    adresse: text("address").notNull(),
    permanence: boolean("enrollment_desk").notNull().default(false),
  },
  (t) => [cibleMemeEcole(t)],
);

/**
 * Jours et heures d'ouverture d'un site (#90) : un jour absent est fermé. Un
 * site sans aucun horaire saisi n'impose rien (le planning reste libre).
 */
export const horaireSite = pgTable(
  "site_hours",
  {
    ecoleId: ecoleId(),
    siteId: uuid("site_id").notNull(),
    jourSemaine: smallint("weekday").notNull(), // 1 = lundi … 7 = dimanche
    ouverture: time("opens_at").notNull(),
    fermeture: time("closes_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.jourSemaine] }),
    check("site_hours_weekday", sql`${t.jourSemaine} BETWEEN 1 AND 7`),
    check("site_hours_order", sql`${t.fermeture} > ${t.ouverture}`),
    memeEcole(t, t.siteId, site).onDelete("cascade"),
  ],
);

export const salle = pgTable(
  "room",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    siteId: uuid("site_id").notNull(),
    nom: text("name").notNull(),
    capacite: integer("capacity"),
  },
  (t) => [cibleMemeEcole(t), memeEcole(t, t.siteId, site)],
);

export const saison = pgTable(
  "season",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    libelle: text("label").notNull(), // '2027-2028'
    dateDebut: date("start_date").notNull(),
    dateFin: date("end_date").notNull(),
  },
  (t) => [
    unique().on(t.ecoleId, t.libelle),
    check("season_dates", sql`${t.dateFin} > ${t.dateDebut}`),
    cibleMemeEcole(t),
  ],
);

export const fermeture = pgTable(
  "closure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("season_id").notNull(),
    libelle: text("label").notNull(),
    debut: date("start_date").notNull(),
    fin: date("end_date").notNull(),
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
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    type: typePersonne("type").notNull().default("particulier"),
    nom: text("last_name").notNull(),
    prenom: text("first_name"),
    raisonSociale: text("company_name"),
    siren: char("siren", { length: 9 }),
    dateNaissance: date("birth_date"),
    email: text("email"),
    telephone: text("phone"),
    adresse: text("address"),
    notes: text("notes"), // santé, consignes : visibles par l'accueil et la direction
    // Élève de l'école (danseur) ; sinon contact : parent, payeur, organisme.
    eleve: boolean("is_student").notNull().default(false),
    refOutil: text("tool_ref"), // id du client dans l'outil de facturation
    creeLe: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("person_company_siren", sql`${t.type} = 'particulier' OR ${t.siren} IS NOT NULL`),
    index().on(t.ecoleId, t.nom),
    cibleMemeEcole(t),
  ],
);

/**
 * Lien orienté : `personne` est <type> de `lie_a` (Hélène, représentante
 * légale de Zoé). Un conjoint n'est enregistré qu'une fois, dans un sens.
 */
export const lien = pgTable(
  "relationship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    personneId: uuid("person_id").notNull(),
    lieAId: uuid("related_person_id").notNull(),
    type: typeLien("type").notNull(),
    contactUrgence: boolean("emergency_contact").notNull().default(false),
    paiePour: boolean("pays_for").notNull().default(false),
  },
  (t) => [
    unique().on(t.personneId, t.lieAId),
    check("relationship_distinct", sql`${t.personneId} <> ${t.lieAId}`),
    index().on(t.lieAId),
    memeEcole(t, t.personneId, personne),
    memeEcole(t, t.lieAId, personne),
  ],
);

export const documentDanseur = pgTable(
  "student_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    danseurId: uuid("student_id").notNull(),
    type: typeDocument("type").notNull(),
    accorde: boolean("granted").notNull().default(true),
    valideJusqu: date("valid_until"),
    fichier: text("file"),
  },
  (t) => [memeEcole(t, t.danseurId, personne)],
);

// ---------------------------------------------------------------------------
// Professeurs
// ---------------------------------------------------------------------------
export const intervenant = pgTable(
  "instructor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    nom: text("last_name").notNull(),
    prenom: text("first_name").notNull(),
    email: text("email"),
    statut: statutIntervenant("status").notNull(),
    siren: char("siren", { length: 9 }),
    regimeTva: regimeTva("vat_regime").notNull(),
    estDirigeant: boolean("is_owner").notNull().default(false),
    modeRemuneration: modeRemuneration("pay_mode").notNull(),
    tarifCentimes: integer("rate_cents").notNull(), // par heure, cours ou mois
    actif: boolean("active").notNull().default(true),
    // Abonnement à l'agenda : seule l'empreinte SHA-256 du jeton est gardée.
    jetonAgendaHash: text("calendar_token_hash").unique(),
    jetonAgendaCreeLe: timestamp("calendar_token_created_at", { withTimezone: true }),
  },
  (t) => [cibleMemeEcole(t)],
);

/**
 * Plage où un intervenant n'est pas disponible : saisie par la direction, ou
 * lue dans son agenda (plage occupée seulement, jamais le contenu).
 */
export const indisponibilite = pgTable(
  "unavailability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    intervenantId: uuid("instructor_id").notNull(),
    debut: timestamp("starts_at", { withTimezone: true }).notNull(),
    fin: timestamp("ends_at", { withTimezone: true }).notNull(),
    origine: origineIndisponibilite("source").notNull().default("saisie"),
    libelle: text("label"), // saisie seulement
    creeLe: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("unavailability_end", sql`${t.fin} > ${t.debut}`),
    index().on(t.intervenantId, t.debut),
    memeEcole(t, t.intervenantId, intervenant),
  ],
);

/**
 * Agenda Google ou Microsoft connecté par un intervenant : jeton de
 * rafraîchissement chiffré (src/lib/chiffrement.ts), jamais en clair.
 */
export const connexionAgenda = pgTable(
  "calendar_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    intervenantId: uuid("instructor_id").notNull(),
    fournisseur: fournisseurAgenda("provider").notNull(),
    compte: text("account"),
    jetonChiffre: text("encrypted_token").notNull(),
    derniereSynchro: timestamp("last_synced_at", { withTimezone: true }),
    erreur: text("error"),
    creeLe: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    nom: text("name").notNull(),
  },
  (t) => [unique().on(t.ecoleId, t.nom), cibleMemeEcole(t)],
);

export const cours = pgTable(
  "course",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("season_id").notNull(),
    disciplineId: uuid("discipline_id").notNull(),
    salleId: uuid("room_id").notNull(),
    intervenantId: uuid("instructor_id").notNull(),
    type: typeCours("type").notNull().default("collectif"),
    niveau: text("level"),
    ageMin: smallint("age_min"),
    ageMax: smallint("age_max"),
    recurrence: recurrenceCours("recurrence").notNull().default("hebdomadaire"),
    jourSemaine: smallint("weekday"), // 1 = lundi ; NULL pour des dates précises (table cours_date)
    // Période limitée d'un cours régulier dans la saison ; NULL : depuis le début, jusqu'à la fin.
    dateDebut: date("start_date"),
    dateFin: date("end_date"),
    heureDebut: time("start_time").notNull(),
    dureeMinutes: integer("duration_minutes").notNull(),
    capaciteMax: integer("max_capacity"),
  },
  (t) => [
    check("course_weekday", sql`${t.jourSemaine} BETWEEN 1 AND 7`),
    check("course_recurrence_weekday", sql`(${t.recurrence} = 'dates') = (${t.jourSemaine} IS NULL)`),
    check("course_period", sql`${t.dateDebut} IS NULL OR ${t.dateFin} IS NULL OR ${t.dateDebut} <= ${t.dateFin}`),
    check("course_duration", sql`${t.dureeMinutes} > 0`),
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
  "course_date",
  {
    ecoleId: ecoleId(),
    coursId: uuid("course_id").notNull(),
    date: date("date").notNull(),
  },
  (t) => [primaryKey({ columns: [t.coursId, t.date] }), memeEcole(t, t.coursId, cours).onDelete("cascade")],
);

export const seance = pgTable(
  "lesson",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    coursId: uuid("course_id").notNull(),
    date: date("date").notNull(),
    // Séance déplacée (#90) : sa date d'origine, qui sert de repère à la génération des séances.
    datePrevue: date("planned_date"),
    // Heure et durée propres à la séance (déplacée, ou figée avant un changement de créneau) ; NULL : celles du cours.
    heureDebut: time("start_time"),
    dureeMinutes: integer("duration_minutes"),
    statut: statutSeance("status").notNull().default("prevue"),
    intervenantId: uuid("instructor_id").notNull(), // remplaçant possible
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
  "attendance",
  {
    ecoleId: ecoleId(),
    seanceId: uuid("lesson_id").notNull(),
    danseurId: uuid("student_id").notNull(),
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
  "tariff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("season_id").notNull(),
    public: publicTarif("audience").notNull(),
    periodicite: periodicite("period").notNull(),
    // Durées des cours de la semaine, en minutes, triées : {45,45,60} = « 45 min + 45 min + 1 h 00 ».
    combinaison: smallint("combination").array().notNull(),
    // Forfait réservé à une discipline (ex. « Zumba 2 h 00 ») ; NULL = toutes disciplines.
    disciplineId: uuid("discipline_id"),
    prixCentimes: integer("price_cents").notNull(),
  },
  (t) => [
    // NULLS NOT DISTINCT : deux lignes « toutes disciplines » identiques sont refusées.
    unique("tariff_cell_unique")
      .on(t.saisonId, t.public, t.periodicite, t.combinaison, t.disciplineId)
      .nullsNotDistinct(),
    check("tariff_combination", sql`cardinality(${t.combinaison}) >= 1 AND 0 < ALL(${t.combinaison})`),
    cibleMemeEcole(t),
    memeEcole(t, t.saisonId, saison),
    memeEcole(t, t.disciplineId, discipline),
  ],
);

export const reduction = pgTable(
  "discount",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("season_id").notNull(),
    code: text("code").notNull(), // type de réduction connu du moteur de tarif : 'fratrie'
    tauxPointsBase: integer("rate_bps"), // 1000 = 10 %
    montantCentimes: integer("amount_cents"),
    nonCumulableAvec: text("not_combinable_with")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Nombre minimal de danseurs éligibles du même payeur (fratrie : 2).
    seuilDanseurs: smallint("min_students").notNull().default(1),
    // Publics éligibles ; vide = tous.
    publics: publicTarif("audiences")
      .array()
      .notNull()
      .default(sql`'{}'::tariff_audience[]`),
    // false : écartée sur un forfait dont les cours relèvent d'au moins 2 disciplines.
    cumulableMultiDisciplines: boolean("combinable_with_multi_discipline").notNull().default(true),
  },
  (t) => [
    unique().on(t.saisonId, t.code),
    check("discount_value", sql`${t.tauxPointsBase} IS NOT NULL OR ${t.montantCentimes} IS NOT NULL`),
    memeEcole(t, t.saisonId, saison),
  ],
);

/**
 * Grille des carnets de cours particuliers : une ligne par nombre de séances
 * et tranche de personnes (« jusqu'à personnes_max »). Au-delà de la dernière
 * tranche : devis, prix saisi sur le carnet.
 */
export const tarifCarnet = pgTable(
  "lesson_pack_tariff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    saisonId: uuid("season_id").notNull(),
    nbSeances: smallint("lesson_count").notNull(),
    personnesMax: smallint("max_people").notNull(),
    prixCentimes: integer("price_cents").notNull(),
  },
  (t) => [
    unique("lesson_pack_tariff_cell_unique").on(t.saisonId, t.nbSeances, t.personnesMax),
    check("lesson_pack_tariff_values", sql`${t.nbSeances} >= 1 AND ${t.personnesMax} >= 1 AND ${t.prixCentimes} >= 0`),
    memeEcole(t, t.saisonId, saison),
  ],
);

// ---------------------------------------------------------------------------
// Inscriptions
// ---------------------------------------------------------------------------
/** Un forfait payé par un payeur ; peut couvrir deux danseurs (tarif couple). */
export const inscription = pgTable(
  "enrollment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    payeurId: uuid("payer_id").notNull(),
    saisonId: uuid("season_id").notNull(),
    tarifId: uuid("tariff_id"),
    // Public et périodicité choisis : nécessaires pour recalculer la fratrie
    // avec les inscriptions existantes, même sans tarif retenu (prix manuel).
    public: publicTarif("audience").notNull(),
    periodicite: periodicite("period").notNull(),
    statut: statutInscription("status").notNull().default("active"),
    dateInscription: date("enrolled_on").notNull().defaultNow(),
    prixBrutCentimes: integer("gross_price_cents").notNull(),
    remiseCentimes: integer("discount_cents").notNull().default(0),
    prixNetCentimes: integer("net_price_cents").generatedAlwaysAs(sql`gross_price_cents - discount_cents`),
    reductions: text("discounts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    creeLe: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  "enrollment_course",
  {
    ecoleId: ecoleId(),
    inscriptionId: uuid("enrollment_id").notNull(),
    danseurId: uuid("student_id").notNull(),
    coursId: uuid("course_id").notNull(),
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
  "lesson_pack",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    payeurId: uuid("payer_id").notNull(),
    nbPersonnes: smallint("people_count").notNull(),
    seancesTotal: smallint("lesson_count").notNull(),
    prixCentimes: integer("price_cents").notNull(),
    acheteLe: date("purchased_on").notNull().defaultNow(),
  },
  (t) => [
    check("lesson_pack_people", sql`${t.nbPersonnes} >= 1 AND ${t.seancesTotal} >= 1`),
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, personne),
  ],
);

export const carnetUtilisation = pgTable(
  "lesson_pack_usage",
  {
    ecoleId: ecoleId(),
    carnetId: uuid("lesson_pack_id").notNull(),
    seanceId: uuid("lesson_id").notNull(),
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
  "invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    payeurId: uuid("payer_id").notNull(),
    statut: statutFacture("status").notNull().default("a_envoyer"),
    outil: outilFacturation("tool"),
    refOutil: text("tool_ref"),
    numero: text("number"), // renvoyé par l'outil, jamais saisi ici
    dateEmission: date("issued_on"),
    totalHtCentimes: integer("total_excl_tax_cents").notNull().default(0),
    totalTvaCentimes: integer("total_vat_cents").notNull().default(0),
    totalTtcCentimes: integer("total_incl_tax_cents").notNull().default(0),
    avoirDe: uuid("credit_note_of"),
    pdfUrl: text("pdf_url"),
    creeLe: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  "invoice_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    factureId: uuid("invoice_id").notNull(),
    libelle: text("label").notNull(),
    quantiteMilliemes: integer("quantity_thousandths").notNull().default(1000), // 1000 = 1
    prixUnitaireCentimes: integer("unit_price_cents").notNull(),
    tauxTvaPointsBase: integer("vat_rate_bps").notNull().default(0), // 2000 = 20 %
    inscriptionId: uuid("enrollment_id"),
    carnetId: uuid("lesson_pack_id"), // NULL : stage, location, billet…
  },
  (t) => [
    memeEcole(t, t.factureId, facture),
    memeEcole(t, t.inscriptionId, inscription),
    memeEcole(t, t.carnetId, carnet),
  ],
);

export const echeance = pgTable(
  "installment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    factureId: uuid("invoice_id").notNull(),
    rang: smallint("rank").notNull(),
    datePrevue: date("due_date").notNull(),
    montantCentimes: integer("amount_cents").notNull(),
    statut: statutEcheance("status").notNull().default("a_venir"),
  },
  (t) => [
    unique().on(t.factureId, t.rang),
    index("installment_open")
      .on(t.ecoleId, t.datePrevue)
      .where(sql`${t.statut} IN ('a_venir', 'partielle', 'en_retard')`),
    cibleMemeEcole(t),
    memeEcole(t, t.factureId, facture),
  ],
);

/** Inaltérable : une erreur ou un remboursement = un paiement négatif. */
export const paiement = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    payeurId: uuid("payer_id").notNull(),
    date: date("date").notNull().defaultNow(),
    montantCentimes: integer("amount_cents").notNull(),
    moyen: moyenPaiement("method").notNull(),
    reference: text("reference"), // numéro de chèque, d'autorisation…
    // Banque ou titulaire d'un chèque quand ce n'est pas le payeur (#97).
    emetteur: text("issuer"),
    // Chèque à encaisser plus tard (remis à l'inscription, encaissé au trimestre) ; NULL : tout de suite.
    encaissementPrevu: date("deposit_planned_on"),
    // Correction : paiement négatif qui annule tout ou partie de ce paiement-ci.
    corrigeId: uuid("corrects_id"),
    saisiPar: uuid("entered_by"),
    synchroOutil: boolean("tool_synced").notNull().default(false),
    creeLe: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("payment_amount", sql`${t.montantCentimes} <> 0`),
    cibleMemeEcole(t),
    memeEcole(t, t.payeurId, personne),
    memeEcole(t, t.saisiPar, membre),
    memeEcole(t, t.corrigeId, t),
  ],
);

/** Moyens remis à la banque (ou à l'ANCV) par bordereau (#98). */
export const moyenRemise = pgEnum("deposit_method", ["cheque", "especes", "cheque_vacances"]);

/** Remise en banque : un bordereau de chèques, d'espèces ou de chèques vacances déposés ensemble (#98). */
export const remise = pgTable(
  "bank_deposit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    date: date("date").notNull(),
    moyen: moyenRemise("method").notNull(),
    creePar: uuid("created_by"),
    creeLe: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [cibleMemeEcole(t), memeEcole(t, t.creePar, membre)],
);

/** Paiements d'une remise ; un paiement ne figure que dans une seule remise (le paiement, inaltérable, n'est pas modifié). */
export const remisePaiement = pgTable(
  "bank_deposit_payment",
  {
    ecoleId: ecoleId(),
    remiseId: uuid("bank_deposit_id").notNull(),
    paiementId: uuid("payment_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paiementId] }),
    index().on(t.remiseId),
    memeEcole(t, t.remiseId, remise).onDelete("cascade"),
    memeEcole(t, t.paiementId, paiement),
  ],
);

export const affectationPaiement = pgTable(
  "payment_allocation",
  {
    ecoleId: ecoleId(),
    paiementId: uuid("payment_id").notNull(),
    echeanceId: uuid("installment_id").notNull(),
    montantCentimes: integer("amount_cents").notNull(),
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
  "instructor_statement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ecoleId: ecoleId(),
    intervenantId: uuid("instructor_id").notNull(),
    mois: date("month").notNull(), // 1er jour du mois
    nbSeances: integer("lesson_count").notNull(),
    minutes: integer("minutes").notNull(),
    montantDuCentimes: integer("amount_due_cents").notNull(),
    factureRecue: text("invoice_received"),
    montantFactureCentimes: integer("invoiced_amount_cents"),
    statut: statutReleve("status").notNull().default("a_controler"),
  },
  (t) => [unique().on(t.intervenantId, t.mois), memeEcole(t, t.intervenantId, intervenant)],
);

// ---------------------------------------------------------------------------
// Journal d'audit (append-only)
// ---------------------------------------------------------------------------
export const journal = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ecoleId: ecoleId(),
    quand: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    qui: uuid("actor"),
    tableCible: text("target_table").notNull(),
    ligneId: uuid("row_id").notNull(),
    action: text("action").notNull(), // insert | update | delete
    avant: jsonb("before"),
    apres: jsonb("after"),
  },
  (t) => [index().on(t.ecoleId, t.tableCible, t.ligneId), memeEcole(t, t.qui, membre)],
);

// ---------------------------------------------------------------------------
// Authentification (Better Auth) : tables GLOBALES, sans school_id ni RLS.
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
    // l'appartenance. Pas nommée school_id : la session n'est pas une donnée d'école.
    ecoleChoisie: uuid("selected_school_id").references(() => ecole.id, { onDelete: "set null" }),
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
  "login_attempt",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cle: text("key").notNull(),
    quand: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
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
