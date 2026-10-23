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
export const personType = pgEnum("person_type", ["particulier", "professionnel"]);
export const relationshipType = pgEnum("relationship_type", ["representant_legal", "conjoint", "autre"]);
export const documentType = pgEnum("document_type", [
  "certificat_medical",
  "autorisation_parentale",
  "droit_image",
  "autre",
]);
export const instructorStatus = pgEnum("instructor_status", ["micro_entreprise", "societe", "salarie"]);
export const vatRegime = pgEnum("vat_regime", ["franchise_293b", "assujetti", "non_applicable"]);
export const payMode = pgEnum("pay_mode", ["heure", "cours", "forfait_mensuel"]);
export const courseType = pgEnum("course_type", ["collectif", "particulier", "competition", "stage"]);
export const lessonStatus = pgEnum("lesson_status", ["prevue", "effectuee", "annulee"]);
/** Chaque semaine, une semaine sur deux, ou à des dates précises (#90). */
export const courseRecurrence = pgEnum("course_recurrence", ["hebdomadaire", "quinzaine", "dates"]);
export const unavailabilitySource = pgEnum("unavailability_source", ["saisie", "google", "microsoft"]);
export const calendarProvider = pgEnum("calendar_provider", ["google", "microsoft"]);
export const tariffAudience = pgEnum("tariff_audience", ["enfant", "adulte", "couple", "etudiant"]);
export const period = pgEnum("period", ["trimestre", "annee", "unite"]);
export const enrollmentStatus = pgEnum("enrollment_status", [
  "essai",
  "liste_attente",
  "active",
  "abandon",
  "terminee",
]);
export const invoiceStatus = pgEnum("invoice_status", ["a_envoyer", "brouillon_outil", "emise", "rejetee", "annulee"]);
export const invoicingTool = pgEnum("invoicing_tool", ["pennylane", "abby", "shine"]);
export const paymentMethod = pgEnum("payment_method", [
  "cheque",
  "especes",
  "carte",
  "virement",
  "prelevement",
  "cheque_vacances",
  "pass_sport",
  "autre",
]);
export const installmentStatus = pgEnum("installment_status", [
  "a_venir",
  "payee",
  "partielle",
  "en_retard",
  "annulee",
]);
export const statementStatus = pgEnum("statement_status", ["a_controler", "conforme", "ecart", "paye"]);
export const memberRole = pgEnum("member_role", ["direction", "accueil", "professeur"]);

// ---------------------------------------------------------------------------
// Locataire : l'école
// ---------------------------------------------------------------------------
export const school = pgTable("school", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // sous-domaine : ribas.monapp.fr
  companyName: text("company_name"),
  siren: char("siren", { length: 9 }),
  vatRegime: vatRegime("vat_regime").notNull().default("non_applicable"),
  vatMention: text("vat_mention"), // ex. « TVA non applicable, art. 293 B du CGI »
  timeZone: text("time_zone").notNull().default("Europe/Paris"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Colonne `school_id` commune à toutes les tables métier. */
const schoolIdColumn = () =>
  uuid("school_id")
    .notNull()
    .references(() => school.id, { onDelete: "cascade" });

/**
 * Clé étrangère entre deux tables métier : composite (school_id, colonne) vers
 * (school_id, id), pour que la ligne visée appartienne forcément à la même école.
 * Une clé étrangère simple ne suffit pas : sa vérification ignore la Row Level
 * Security. Colonne NULL acceptée (MATCH SIMPLE). Nom : <table>_<colonne>_same_school_fk.
 */
function memeEcole(
  t: { schoolId: AnyPgColumn },
  colonne: AnyPgColumn,
  cible: { schoolId: AnyPgColumn; id: AnyPgColumn },
) {
  return foreignKey({
    name: `${getTableName(colonne.table)}_${colonne.name.replace(/_id$/, "")}_same_school_fk`,
    columns: [t.schoolId, colonne],
    foreignColumns: [cible.schoolId, cible.id],
  });
}

/** Contrainte unique (school_id, id), cible des clés étrangères `memeEcole`. */
function cibleMemeEcole(t: { schoolId: AnyPgColumn; id: AnyPgColumn }) {
  return unique(`${getTableName(t.id.table)}_school_id_id_unique`).on(t.schoolId, t.id);
}

/** Configuration du connecteur de facturation, une par école. */
export const invoicingConnector = pgTable("invoicing_connector", {
  schoolId: uuid("school_id")
    .primaryKey()
    .references(() => school.id, { onDelete: "cascade" }),
  tool: invoicingTool("tool").notNull(),
  encryptedCredentials: text("encrypted_credentials").notNull(), // chiffré côté application
  oneConnectEnabled: boolean("one_connect_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Appartenance d'un utilisateur (géré par Better Auth, table `user`) à une
 * école, avec son rôle. Un même compte peut appartenir à plusieurs écoles.
 */
export const member = pgTable(
  "member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    userId: text("user_id")
      .notNull()
      .references((): AnyPgColumn => user.id), // compte Better Auth (global, toutes écoles)
    role: memberRole("role").notNull(),
    instructorId: uuid("instructor_id"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [unique().on(t.schoolId, t.userId), cibleMemeEcole(t), memeEcole(t, t.instructorId, instructor)],
);

/** Lien envoyé à une personne : rejoindre l'équipe, ou choisir un nouveau mot de passe (#104). */
export const invitationType = pgEnum("invitation_type", ["invitation", "reinitialisation"]);

/**
 * Invitation dans l'équipe d'une école, ou réinitialisation du mot de passe
 * d'un membre (#104). Le jeton n'est montré qu'une fois, dans le lien ; seule
 * son empreinte est gardée. Usage unique, durée limitée.
 */
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    type: invitationType("type").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    role: memberRole("role"), // invitation : rôle donné en rejoignant l'école
    userId: text("user_id").references((): AnyPgColumn => user.id, { onDelete: "cascade" }), // réinitialisation : compte visé
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by"),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "invitation_content",
      sql`(${t.type} = 'invitation' AND ${t.role} IS NOT NULL) OR (${t.type} = 'reinitialisation' AND ${t.userId} IS NOT NULL)`,
    ),
    memeEcole(t, t.createdBy, member),
  ],
);

/**
 * Disposition des colonnes d'une liste (élèves, contacts…) propre à chaque
 * membre (#89) : identifiants des colonnes affichées, dans l'ordre. Une simple
 * préférence d'affichage, supprimée avec le membre.
 */
export const listPreference = pgTable(
  "list_preference",
  {
    schoolId: schoolIdColumn(),
    memberId: uuid("member_id").notNull(),
    list: text("list").notNull(),
    columns: text("columns").array().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.list] }), memeEcole(t, t.memberId, member).onDelete("cascade")],
);

// ---------------------------------------------------------------------------
// Lieux et calendrier
// ---------------------------------------------------------------------------
export const site = pgTable(
  "site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    enrollmentDesk: boolean("enrollment_desk").notNull().default(false),
  },
  (t) => [cibleMemeEcole(t)],
);

/**
 * Jours et heures d'ouverture d'un site (#90) : un jour absent est fermé. Un
 * site sans aucun horaire saisi n'impose rien (le planning reste libre).
 */
export const siteHours = pgTable(
  "site_hours",
  {
    schoolId: schoolIdColumn(),
    siteId: uuid("site_id").notNull(),
    weekday: smallint("weekday").notNull(), // 1 = lundi … 7 = dimanche
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.weekday] }),
    check("site_hours_weekday", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("site_hours_order", sql`${t.closesAt} > ${t.opensAt}`),
    memeEcole(t, t.siteId, site).onDelete("cascade"),
  ],
);

export const room = pgTable(
  "room",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    siteId: uuid("site_id").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity"),
  },
  (t) => [cibleMemeEcole(t), memeEcole(t, t.siteId, site)],
);

export const season = pgTable(
  "season",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    label: text("label").notNull(), // '2027-2028'
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
  },
  (t) => [
    unique().on(t.schoolId, t.label),
    check("season_dates", sql`${t.endDate} > ${t.startDate}`),
    cibleMemeEcole(t),
  ],
);

export const closure = pgTable(
  "closure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    seasonId: uuid("season_id").notNull(),
    label: text("label").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
  },
  (t) => [memeEcole(t, t.seasonId, season)],
);

// ---------------------------------------------------------------------------
// Personnes et liens (plus de « famille » : voir #67)
// ---------------------------------------------------------------------------
/**
 * Toute personne connue de l'école : danseur, parent, conjoint, contact
 * d'urgence, ou payeur professionnel (entreprise, CSE). Un adulte seul est à la
 * fois danseur et payeur : pas de « famille » à créer.
 */
export const person = pgTable(
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    type: personType("type").notNull().default("particulier"),
    lastName: text("last_name").notNull(),
    firstName: text("first_name"),
    companyName: text("company_name"),
    siren: char("siren", { length: 9 }),
    birthDate: date("birth_date"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    notes: text("notes"), // santé, consignes : visibles par l'accueil et la direction
    // Élève de l'école (danseur) ; sinon contact : parent, payeur, organisme.
    isStudent: boolean("is_student").notNull().default(false),
    toolRef: text("tool_ref"), // id du client dans l'outil de facturation
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("person_company_siren", sql`${t.type} = 'particulier' OR ${t.siren} IS NOT NULL`),
    index().on(t.schoolId, t.lastName),
    cibleMemeEcole(t),
  ],
);

/**
 * Lien orienté : `personne` est <type> de `lie_a` (Hélène, représentante
 * légale de Zoé). Un conjoint n'est enregistré qu'une fois, dans un sens.
 */
export const relationship = pgTable(
  "relationship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    personId: uuid("person_id").notNull(),
    relatedPersonId: uuid("related_person_id").notNull(),
    type: relationshipType("type").notNull(),
    emergencyContact: boolean("emergency_contact").notNull().default(false),
    paysFor: boolean("pays_for").notNull().default(false),
  },
  (t) => [
    unique().on(t.personId, t.relatedPersonId),
    check("relationship_distinct", sql`${t.personId} <> ${t.relatedPersonId}`),
    index().on(t.relatedPersonId),
    memeEcole(t, t.personId, person),
    memeEcole(t, t.relatedPersonId, person),
  ],
);

export const studentDocument = pgTable(
  "student_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    studentId: uuid("student_id").notNull(),
    type: documentType("type").notNull(),
    granted: boolean("granted").notNull().default(true),
    validUntil: date("valid_until"),
    file: text("file"),
  },
  (t) => [memeEcole(t, t.studentId, person)],
);

// ---------------------------------------------------------------------------
// Professeurs
// ---------------------------------------------------------------------------
export const instructor = pgTable(
  "instructor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    email: text("email"),
    status: instructorStatus("status").notNull(),
    siren: char("siren", { length: 9 }),
    vatRegime: vatRegime("vat_regime").notNull(),
    isOwner: boolean("is_owner").notNull().default(false),
    payMode: payMode("pay_mode").notNull(),
    rateCents: integer("rate_cents").notNull(), // par heure, cours ou mois
    active: boolean("active").notNull().default(true),
    // Abonnement à l'agenda : seule l'empreinte SHA-256 du jeton est gardée.
    calendarTokenHash: text("calendar_token_hash").unique(),
    calendarTokenCreatedAt: timestamp("calendar_token_created_at", { withTimezone: true }),
  },
  (t) => [cibleMemeEcole(t)],
);

/**
 * Plage où un intervenant n'est pas disponible : saisie par la direction, ou
 * lue dans son agenda (plage occupée seulement, jamais le contenu).
 */
export const unavailability = pgTable(
  "unavailability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    instructorId: uuid("instructor_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    source: unavailabilitySource("source").notNull().default("saisie"),
    label: text("label"), // saisie seulement
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("unavailability_end", sql`${t.endsAt} > ${t.startsAt}`),
    index().on(t.instructorId, t.startsAt),
    memeEcole(t, t.instructorId, instructor),
  ],
);

/**
 * Agenda Google ou Microsoft connecté par un intervenant : jeton de
 * rafraîchissement chiffré (src/lib/chiffrement.ts), jamais en clair.
 */
export const calendarConnection = pgTable(
  "calendar_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    instructorId: uuid("instructor_id").notNull(),
    provider: calendarProvider("provider").notNull(),
    account: text("account"),
    encryptedToken: text("encrypted_token").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.instructorId), memeEcole(t, t.instructorId, instructor)],
);

// ---------------------------------------------------------------------------
// Offre et planning
// ---------------------------------------------------------------------------
export const discipline = pgTable(
  "discipline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    name: text("name").notNull(),
  },
  (t) => [unique().on(t.schoolId, t.name), cibleMemeEcole(t)],
);

export const course = pgTable(
  "course",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    seasonId: uuid("season_id").notNull(),
    disciplineId: uuid("discipline_id").notNull(),
    roomId: uuid("room_id").notNull(),
    instructorId: uuid("instructor_id").notNull(),
    type: courseType("type").notNull().default("collectif"),
    level: text("level"),
    ageMin: smallint("age_min"),
    ageMax: smallint("age_max"),
    recurrence: courseRecurrence("recurrence").notNull().default("hebdomadaire"),
    weekday: smallint("weekday"), // 1 = lundi ; NULL pour des dates précises (table cours_date)
    // Période limitée d'un cours régulier dans la saison ; NULL : depuis le début, jusqu'à la fin.
    startDate: date("start_date"),
    endDate: date("end_date"),
    startTime: time("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    maxCapacity: integer("max_capacity"),
  },
  (t) => [
    check("course_weekday", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("course_recurrence_weekday", sql`(${t.recurrence} = 'dates') = (${t.weekday} IS NULL)`),
    check("course_period", sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`),
    check("course_duration", sql`${t.durationMinutes} > 0`),
    index().on(t.seasonId, t.weekday),
    cibleMemeEcole(t),
    memeEcole(t, t.seasonId, season),
    memeEcole(t, t.disciplineId, discipline),
    memeEcole(t, t.roomId, room),
    memeEcole(t, t.instructorId, instructor),
  ],
);

/** Dates d'un cours ponctuel (récurrence « dates » : stage, cours exceptionnel). */
export const courseDate = pgTable(
  "course_date",
  {
    schoolId: schoolIdColumn(),
    courseId: uuid("course_id").notNull(),
    date: date("date").notNull(),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.date] }), memeEcole(t, t.courseId, course).onDelete("cascade")],
);

export const lesson = pgTable(
  "lesson",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    courseId: uuid("course_id").notNull(),
    date: date("date").notNull(),
    // Séance déplacée (#90) : sa date d'origine, qui sert de repère à la génération des séances.
    plannedDate: date("planned_date"),
    // Heure et durée propres à la séance (déplacée, ou figée avant un changement de créneau) ; NULL : celles du cours.
    startTime: time("start_time"),
    durationMinutes: integer("duration_minutes"),
    status: lessonStatus("status").notNull().default("prevue"),
    instructorId: uuid("instructor_id").notNull(), // remplaçant possible
  },
  (t) => [
    unique().on(t.courseId, t.date),
    index().on(t.schoolId, t.date),
    index().on(t.instructorId, t.date),
    cibleMemeEcole(t),
    memeEcole(t, t.courseId, course),
    memeEcole(t, t.instructorId, instructor),
  ],
);

export const attendance = pgTable(
  "attendance",
  {
    schoolId: schoolIdColumn(),
    lessonId: uuid("lesson_id").notNull(),
    studentId: uuid("student_id").notNull(),
    present: boolean("present").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.lessonId, t.studentId] }),
    memeEcole(t, t.lessonId, lesson),
    memeEcole(t, t.studentId, person),
  ],
);

// ---------------------------------------------------------------------------
// Tarifs et réductions
// ---------------------------------------------------------------------------
/** Une ligne par case de la grille : public × périodicité × combinaison de cours (× discipline). */
export const tariff = pgTable(
  "tariff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    seasonId: uuid("season_id").notNull(),
    audience: tariffAudience("audience").notNull(),
    period: period("period").notNull(),
    // Durées des cours de la semaine, en minutes, triées : {45,45,60} = « 45 min + 45 min + 1 h 00 ».
    combination: smallint("combination").array().notNull(),
    // Forfait réservé à une discipline (ex. « Zumba 2 h 00 ») ; NULL = toutes disciplines.
    disciplineId: uuid("discipline_id"),
    priceCents: integer("price_cents").notNull(),
  },
  (t) => [
    // NULLS NOT DISTINCT : deux lignes « toutes disciplines » identiques sont refusées.
    unique("tariff_cell_unique").on(t.seasonId, t.audience, t.period, t.combination, t.disciplineId).nullsNotDistinct(),
    check("tariff_combination", sql`cardinality(${t.combination}) >= 1 AND 0 < ALL(${t.combination})`),
    cibleMemeEcole(t),
    memeEcole(t, t.seasonId, season),
    memeEcole(t, t.disciplineId, discipline),
  ],
);

export const discount = pgTable(
  "discount",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    seasonId: uuid("season_id").notNull(),
    code: text("code").notNull(), // type de réduction connu du moteur de tarif : 'fratrie'
    rateBps: integer("rate_bps"), // 1000 = 10 %
    amountCents: integer("amount_cents"),
    notCombinableWith: text("not_combinable_with")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Nombre minimal de danseurs éligibles du même payeur (fratrie : 2).
    minStudents: smallint("min_students").notNull().default(1),
    // Publics éligibles ; vide = tous.
    audiences: tariffAudience("audiences")
      .array()
      .notNull()
      .default(sql`'{}'::tariff_audience[]`),
    // false : écartée sur un forfait dont les cours relèvent d'au moins 2 disciplines.
    combinableWithMultiDiscipline: boolean("combinable_with_multi_discipline").notNull().default(true),
  },
  (t) => [
    unique().on(t.seasonId, t.code),
    check("discount_value", sql`${t.rateBps} IS NOT NULL OR ${t.amountCents} IS NOT NULL`),
    memeEcole(t, t.seasonId, season),
  ],
);

/**
 * Grille des carnets de cours particuliers : une ligne par nombre de séances
 * et tranche de personnes (« jusqu'à personnes_max »). Au-delà de la dernière
 * tranche : devis, prix saisi sur le carnet.
 */
export const lessonPackTariff = pgTable(
  "lesson_pack_tariff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    seasonId: uuid("season_id").notNull(),
    lessonCount: smallint("lesson_count").notNull(),
    maxPeople: smallint("max_people").notNull(),
    priceCents: integer("price_cents").notNull(),
  },
  (t) => [
    unique("lesson_pack_tariff_cell_unique").on(t.seasonId, t.lessonCount, t.maxPeople),
    check("lesson_pack_tariff_values", sql`${t.lessonCount} >= 1 AND ${t.maxPeople} >= 1 AND ${t.priceCents} >= 0`),
    memeEcole(t, t.seasonId, season),
  ],
);

// ---------------------------------------------------------------------------
// Inscriptions
// ---------------------------------------------------------------------------
/** Un forfait payé par un payeur ; peut couvrir deux danseurs (tarif couple). */
export const enrollment = pgTable(
  "enrollment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    payerId: uuid("payer_id").notNull(),
    seasonId: uuid("season_id").notNull(),
    tariffId: uuid("tariff_id"),
    // Public et périodicité choisis : nécessaires pour recalculer la fratrie
    // avec les inscriptions existantes, même sans tarif retenu (prix manuel).
    audience: tariffAudience("audience").notNull(),
    period: period("period").notNull(),
    status: enrollmentStatus("status").notNull().default("active"),
    enrolledOn: date("enrolled_on").notNull().defaultNow(),
    grossPriceCents: integer("gross_price_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    netPriceCents: integer("net_price_cents").generatedAlwaysAs(sql`gross_price_cents - discount_cents`),
    discounts: text("discounts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.payerId, t.seasonId),
    cibleMemeEcole(t),
    memeEcole(t, t.payerId, person),
    memeEcole(t, t.seasonId, season),
    memeEcole(t, t.tariffId, tariff),
  ],
);

export const enrollmentCourse = pgTable(
  "enrollment_course",
  {
    schoolId: schoolIdColumn(),
    enrollmentId: uuid("enrollment_id").notNull(),
    studentId: uuid("student_id").notNull(),
    courseId: uuid("course_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.enrollmentId, t.studentId, t.courseId] }),
    memeEcole(t, t.enrollmentId, enrollment),
    memeEcole(t, t.studentId, person),
    memeEcole(t, t.courseId, course),
  ],
);

/**
 * Cours particuliers : un carnet acheté, prix figé à l'achat (grille `tarif_carnet`
 * ou devis). Nombres de séances et de personnes : données de l'école, pas de limite ici.
 */
export const lessonPack = pgTable(
  "lesson_pack",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    payerId: uuid("payer_id").notNull(),
    peopleCount: smallint("people_count").notNull(),
    lessonCount: smallint("lesson_count").notNull(),
    priceCents: integer("price_cents").notNull(),
    purchasedOn: date("purchased_on").notNull().defaultNow(),
  },
  (t) => [
    check("lesson_pack_people", sql`${t.peopleCount} >= 1 AND ${t.lessonCount} >= 1`),
    cibleMemeEcole(t),
    memeEcole(t, t.payerId, person),
  ],
);

export const lessonPackUsage = pgTable(
  "lesson_pack_usage",
  {
    schoolId: schoolIdColumn(),
    lessonPackId: uuid("lesson_pack_id").notNull(),
    lessonId: uuid("lesson_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.lessonPackId, t.lessonId] }),
    memeEcole(t, t.lessonPackId, lessonPack),
    memeEcole(t, t.lessonId, lesson),
  ],
);

// ---------------------------------------------------------------------------
// Facturation et encaissements
// ---------------------------------------------------------------------------
export const invoice = pgTable(
  "invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    payerId: uuid("payer_id").notNull(),
    status: invoiceStatus("status").notNull().default("a_envoyer"),
    tool: invoicingTool("tool"),
    toolRef: text("tool_ref"),
    number: text("number"), // renvoyé par l'outil, jamais saisi ici
    issuedOn: date("issued_on"),
    totalExclTaxCents: integer("total_excl_tax_cents").notNull().default(0),
    totalVatCents: integer("total_vat_cents").notNull().default(0),
    totalInclTaxCents: integer("total_incl_tax_cents").notNull().default(0),
    creditNoteOf: uuid("credit_note_of"),
    pdfUrl: text("pdf_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.schoolId, t.number),
    index().on(t.payerId),
    cibleMemeEcole(t),
    memeEcole(t, t.payerId, person),
    memeEcole(t, t.creditNoteOf, t),
  ],
);

export const invoiceLine = pgTable(
  "invoice_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    invoiceId: uuid("invoice_id").notNull(),
    label: text("label").notNull(),
    quantityThousandths: integer("quantity_thousandths").notNull().default(1000), // 1000 = 1
    unitPriceCents: integer("unit_price_cents").notNull(),
    vatRateBps: integer("vat_rate_bps").notNull().default(0), // 2000 = 20 %
    enrollmentId: uuid("enrollment_id"),
    lessonPackId: uuid("lesson_pack_id"), // NULL : stage, location, billet…
  },
  (t) => [
    memeEcole(t, t.invoiceId, invoice),
    memeEcole(t, t.enrollmentId, enrollment),
    memeEcole(t, t.lessonPackId, lessonPack),
  ],
);

export const installment = pgTable(
  "installment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    invoiceId: uuid("invoice_id").notNull(),
    rank: smallint("rank").notNull(),
    dueDate: date("due_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: installmentStatus("status").notNull().default("a_venir"),
  },
  (t) => [
    unique().on(t.invoiceId, t.rank),
    index("installment_open")
      .on(t.schoolId, t.dueDate)
      .where(sql`${t.status} IN ('a_venir', 'partielle', 'en_retard')`),
    cibleMemeEcole(t),
    memeEcole(t, t.invoiceId, invoice),
  ],
);

/** Inaltérable : une erreur ou un remboursement = un paiement négatif. */
export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    payerId: uuid("payer_id").notNull(),
    date: date("date").notNull().defaultNow(),
    amountCents: integer("amount_cents").notNull(),
    method: paymentMethod("method").notNull(),
    reference: text("reference"), // numéro de chèque, d'autorisation…
    // Banque ou titulaire d'un chèque quand ce n'est pas le payeur (#97).
    issuer: text("issuer"),
    // Chèque à encaisser plus tard (remis à l'inscription, encaissé au trimestre) ; NULL : tout de suite.
    depositPlannedOn: date("deposit_planned_on"),
    // Correction : paiement négatif qui annule tout ou partie de ce paiement-ci.
    correctsId: uuid("corrects_id"),
    enteredBy: uuid("entered_by"),
    toolSynced: boolean("tool_synced").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("payment_amount", sql`${t.amountCents} <> 0`),
    cibleMemeEcole(t),
    memeEcole(t, t.payerId, person),
    memeEcole(t, t.enteredBy, member),
    memeEcole(t, t.correctsId, t),
  ],
);

/** Moyens remis à la banque (ou à l'ANCV) par bordereau (#98). */
export const depositMethod = pgEnum("deposit_method", ["cheque", "especes", "cheque_vacances"]);

/** Remise en banque : un bordereau de chèques, d'espèces ou de chèques vacances déposés ensemble (#98). */
export const bankDeposit = pgTable(
  "bank_deposit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    date: date("date").notNull(),
    method: depositMethod("method").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [cibleMemeEcole(t), memeEcole(t, t.createdBy, member)],
);

/** Paiements d'une remise ; un paiement ne figure que dans une seule remise (le paiement, inaltérable, n'est pas modifié). */
export const bankDepositPayment = pgTable(
  "bank_deposit_payment",
  {
    schoolId: schoolIdColumn(),
    bankDepositId: uuid("bank_deposit_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId] }),
    index().on(t.bankDepositId),
    memeEcole(t, t.bankDepositId, bankDeposit).onDelete("cascade"),
    memeEcole(t, t.paymentId, payment),
  ],
);

export const paymentAllocation = pgTable(
  "payment_allocation",
  {
    schoolId: schoolIdColumn(),
    paymentId: uuid("payment_id").notNull(),
    installmentId: uuid("installment_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId, t.installmentId] }),
    memeEcole(t, t.paymentId, payment),
    memeEcole(t, t.installmentId, installment),
  ],
);

// ---------------------------------------------------------------------------
// Rémunération des professeurs
// ---------------------------------------------------------------------------
export const instructorStatement = pgTable(
  "instructor_statement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    instructorId: uuid("instructor_id").notNull(),
    month: date("month").notNull(), // 1er jour du mois
    lessonCount: integer("lesson_count").notNull(),
    minutes: integer("minutes").notNull(),
    amountDueCents: integer("amount_due_cents").notNull(),
    invoiceReceived: text("invoice_received"),
    invoicedAmountCents: integer("invoiced_amount_cents"),
    status: statementStatus("status").notNull().default("a_controler"),
  },
  (t) => [unique().on(t.instructorId, t.month), memeEcole(t, t.instructorId, instructor)],
);

// ---------------------------------------------------------------------------
// Journal d'audit (append-only)
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    schoolId: schoolIdColumn(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: uuid("actor"),
    targetTable: text("target_table").notNull(),
    rowId: uuid("row_id").notNull(),
    action: text("action").notNull(), // insert | update | delete
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [index().on(t.schoolId, t.targetTable, t.rowId), memeEcole(t, t.actor, member)],
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
    selectedSchoolId: uuid("selected_school_id").references(() => school.id, { onDelete: "set null" }),
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
export const loginAttempt = pgTable(
  "login_attempt",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.key, t.at)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
