/**
 * Multi-school data model (SaaS) – Drizzle ORM / PostgreSQL
 *
 * Conventions
 *  - Every business table carries `school_id`: isolation between schools is
 *    guaranteed by Row Level Security (see migrations/0001_rls.sql).
 *  - Amounts in integer CENTS (`*_cents`), rates in basis points
 *    (2000 = 20 %): no floating-point number on the TypeScript side.
 *  - The invoice number is provided by the invoicing tool of the billing
 *    entity that issues the invoice (ADR 0006).
 *  - Payments and the audit log are immutable (triggers in 0001_rls.sql).
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ROLE_VALUES } from "../domain/team/rules";
import { REVERSAL_KINDS } from "../domain/payments/rejection";
import { PAYMENT_METHOD_VALUES } from "../domain/payments/methods";
import { DOCUMENT_TYPES } from "../domain/people/documents";
import { VAT_CATEGORIES } from "../domain/billing/vat";
import { FAKE_NUMBER_PREFIX, INVOICING_TOOLS } from "../domain/billing/invoicing";

// ---------------------------------------------------------------------------
// Enumerated types
// ---------------------------------------------------------------------------
export const personType = pgEnum("person_type", ["individual", "organisation"]);
export const relationshipType = pgEnum("relationship_type", ["legal_guardian", "partner", "other"]);
export const documentType = pgEnum("document_type", DOCUMENT_TYPES);
export const instructorStatus = pgEnum("instructor_status", ["sole_trader", "company", "employee"]);
export const vatRegime = pgEnum("vat_regime", ["franchise_293b", "vat_registered", "not_applicable"]);
// How VAT applies to an operation (#301): EN 16931 S, E, O. Not a regime: a business may mix them.
export const vatCategory = pgEnum("vat_category", VAT_CATEGORIES);
export const payMode = pgEnum("pay_mode", ["hourly", "per_lesson", "monthly_flat"]);
export const courseType = pgEnum("course_type", ["group", "private", "competition", "workshop"]);
export const lessonStatus = pgEnum("lesson_status", ["planned", "done", "cancelled"]);
/** Every week, every other week, or on specific dates (#90). */
export const courseRecurrence = pgEnum("course_recurrence", ["weekly", "biweekly", "dates"]);
/** What a closure covers (#200): the whole school, the sites of `closure_site` or the courses of `closure_course`. */
export const closureScope = pgEnum("closure_scope", ["school", "sites", "courses"]);
export const unavailabilitySource = pgEnum("unavailability_source", ["manual", "google", "microsoft"]);
export const calendarProvider = pgEnum("calendar_provider", ["google", "microsoft"]);
export const tariffAudience = pgEnum("tariff_audience", ["child", "adult", "couple", "student"]);
export const period = pgEnum("period", ["quarter", "year", "single"]);
export const enrollmentStatus = pgEnum("enrollment_status", ["trial", "waitlist", "active", "dropped", "ended"]);
export const invoiceStatus = pgEnum("invoice_status", ["to_send", "tool_draft", "issued", "rejected", "cancelled"]);
/** `fake`: the simulation tool (#303), refused unless INVOICING_FAKE_ALLOWED=1. */
export const invoicingTool = pgEnum("invoicing_tool", INVOICING_TOOLS);
export const paymentMethod = pgEnum("payment_method", PAYMENT_METHOD_VALUES);
/** Kind of a reverse entry (#272): a correction, or the rejection of a deposited payment. */
export const reversalKind = pgEnum("reversal_kind", REVERSAL_KINDS);
export const installmentStatus = pgEnum("installment_status", ["upcoming", "paid", "partial", "overdue", "cancelled"]);
export const statementStatus = pgEnum("statement_status", ["to_check", "matching", "discrepancy", "paid"]);
export const memberRole = pgEnum("member_role", ROLE_VALUES);

// ---------------------------------------------------------------------------
// Tenant: the school
// ---------------------------------------------------------------------------
export const school = pgTable("school", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // subdomain: ribas.monapp.fr
  // Legal name, SIREN and VAT live on its billing entities (`billing_entity`, ADR 0006).
  timeZone: text("time_zone").notNull().default("Europe/Paris"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** `school_id` column shared by all business tables. */
const schoolIdColumn = () =>
  uuid("school_id")
    .notNull()
    .references(() => school.id, { onDelete: "cascade" });

/**
 * Foreign key between two business tables: composite (school_id, column) to
 * (school_id, id), so that the target row necessarily belongs to the same school.
 * A plain foreign key is not enough: its check ignores Row Level
 * Security. NULL column accepted (MATCH SIMPLE). Name: <table>_<column>_same_school_fk.
 */
function sameSchool(
  t: { schoolId: AnyPgColumn },
  column: AnyPgColumn,
  target: { schoolId: AnyPgColumn; id: AnyPgColumn },
) {
  return foreignKey({
    name: `${getTableName(column.table)}_${column.name.replace(/_id$/, "")}_same_school_fk`,
    columns: [t.schoolId, column],
    foreignColumns: [target.schoolId, target.id],
  });
}

/** Unique constraint (school_id, id), target of the `sameSchool` foreign keys. */
function sameSchoolTarget(t: { schoolId: AnyPgColumn; id: AnyPgColumn }) {
  return unique(`${getTableName(t.id.table)}_school_id_id_unique`).on(t.schoolId, t.id);
}

/**
 * Foreign key between two billing tables of the same billing entity (ADR 0006):
 * composite (school_id, column, billing_entity_id) to (school_id, id,
 * billing_entity_id), so that the target row belongs to the same school AND the
 * same entity (an allocation never pays another business's installment). NULL
 * column accepted (MATCH SIMPLE). Name: <table>_<column>_same_entity_fk.
 */
function sameEntity(
  t: { schoolId: AnyPgColumn; billingEntityId: AnyPgColumn },
  column: AnyPgColumn,
  target: { schoolId: AnyPgColumn; id: AnyPgColumn; billingEntityId: AnyPgColumn },
) {
  return foreignKey({
    name: `${getTableName(column.table)}_${column.name.replace(/_id$/, "")}_same_entity_fk`,
    columns: [t.schoolId, column, t.billingEntityId],
    foreignColumns: [target.schoolId, target.id, target.billingEntityId],
  });
}

/** Unique constraint (school_id, id, billing_entity_id), target of the `sameEntity` foreign keys. */
function sameEntityTarget(t: { schoolId: AnyPgColumn; id: AnyPgColumn; billingEntityId: AnyPgColumn }) {
  return unique(`${getTableName(t.id.table)}_school_id_id_billing_entity_id_unique`).on(
    t.schoolId,
    t.id,
    t.billingEntityId,
  );
}

/**
 * How VAT applies to a course or a lesson pack (#301, ADR 0006): a rate, an
 * exemption or out of scope, with the mention printed on its invoice lines.
 * Per school; copied onto each invoice line when drafted, never read back.
 * Wording of labels and mentions: school data (its accountant), never code.
 */
export const vatTreatment = pgTable(
  "vat_treatment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    label: text("label").notNull(), // « Exonéré (art. 261-4-4° b) », « TVA 20 % »
    category: vatCategory("category").notNull(),
    rateBps: integer("rate_bps").notNull().default(0), // 2000 = 20 %; 0 unless standard
    mention: text("mention"), // printed on lines without VAT; required for them
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    sameSchoolTarget(t),
    unique("vat_treatment_label_unique").on(t.schoolId, t.label),
    check(
      "vat_treatment_rate",
      sql`${t.rateBps} BETWEEN 0 AND 10000 AND (${t.category} = 'standard') = (${t.rateBps} > 0)`,
    ),
    check("vat_treatment_mention", sql`${t.category} = 'standard' OR coalesce(btrim(${t.mention}), '') <> ''`),
  ],
);

/**
 * A business that sells, invoices and cashes inside a school (UI « Entreprise »,
 * ADR 0006): its own SIREN, VAT regime, invoice mention and bank account. A school
 * has at least one, exactly one by default; it is not a tenant (RLS stays per school).
 */
export const billingEntity = pgTable(
  "billing_entity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    name: text("name").notNull(), // short label shown in lists: « Danse Zz »
    legalName: text("legal_name").notNull(),
    siren: char("siren", { length: 9 }),
    siret: char("siret", { length: 14 }),
    vatNumber: text("vat_number"),
    addressLine: text("address_line"),
    postalCode: text("postal_code"),
    city: text("city"),
    vatRegime: vatRegime("vat_regime").notNull(),
    vatMention: text("vat_mention"), // printed once per invoice; wording set by the school (its accountant)
    bankAccountLabel: text("bank_account_label"), // printed on deposit slips; never an IBAN
    // Treatment given to its new lesson packs and proposed for its new courses (#301).
    defaultVatTreatmentId: uuid("default_vat_treatment_id"),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    sameSchoolTarget(t),
    unique("billing_entity_name_unique").on(t.schoolId, t.name),
    uniqueIndex("billing_entity_one_default")
      .on(t.schoolId)
      .where(sql`${t.isDefault}`),
    check("billing_entity_siren", sql`${t.siren} ~ '^[0-9]{9}$'`),
    check("billing_entity_siret", sql`${t.siret} ~ '^[0-9]{14}$' AND left(${t.siret}, 9) = ${t.siren}`),
    check("billing_entity_default_active", sql`${t.active} OR NOT ${t.isDefault}`),
    sameSchool(t, t.defaultVatTreatmentId, vatTreatment),
  ],
);

/** Invoicing connector configuration, one per billing entity (ADR 0007). */
export const invoicingConnector = pgTable(
  "invoicing_connector",
  {
    billingEntityId: uuid("billing_entity_id").primaryKey(),
    schoolId: schoolIdColumn(),
    tool: invoicingTool("tool").notNull(),
    encryptedCredentials: text("encrypted_credentials").notNull(), // encrypted on the application side
    oneConnectEnabled: boolean("one_connect_enabled").notNull().default(false),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [sameSchool(t, t.billingEntityId, billingEntity).onDelete("cascade")],
);

/**
 * Membership of a user (managed by Better Auth, `user` table) in a
 * school, with their role. The same account can belong to several schools.
 */
export const member = pgTable(
  "member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    userId: text("user_id")
      .notNull()
      .references((): AnyPgColumn => user.id), // Better Auth account (global, all schools)
    role: memberRole("role").notNull(),
    instructorId: uuid("instructor_id"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [unique().on(t.schoolId, t.userId), sameSchoolTarget(t), sameSchool(t, t.instructorId, instructor)],
);

/** Link sent to a person: join the team, or choose a new password (#104). */
export const invitationType = pgEnum("invitation_type", ["invitation", "reset"]);

/**
 * Invitation to a school's team, or password reset for a
 * member (#104). The token is shown only once, in the link; only
 * its hash is kept. Single use, limited lifetime.
 */
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    type: invitationType("type").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    role: memberRole("role"), // invitation: role given when joining the school
    userId: text("user_id").references((): AnyPgColumn => user.id, { onDelete: "cascade" }), // reset: target account
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by"),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "invitation_content",
      sql`(${t.type} = 'invitation' AND ${t.role} IS NOT NULL) OR (${t.type} = 'reset' AND ${t.userId} IS NOT NULL)`,
    ),
    sameSchool(t, t.createdBy, member),
  ],
);

/**
 * Column layout of a list (students, contacts…) specific to each
 * member (#89): ids of the displayed columns, in order. A mere
 * display preference, deleted with the member.
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
  (t) => [primaryKey({ columns: [t.memberId, t.list] }), sameSchool(t, t.memberId, member).onDelete("cascade")],
);

// ---------------------------------------------------------------------------
// Premises and calendar
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
  (t) => [sameSchoolTarget(t)],
);

/**
 * Opening days and hours of a site (#90): a missing day is closed. A
 * site without any hours entered imposes nothing (the schedule stays free).
 */
export const siteHours = pgTable(
  "site_hours",
  {
    schoolId: schoolIdColumn(),
    siteId: uuid("site_id").notNull(),
    weekday: smallint("weekday").notNull(), // 1 = Monday … 7 = Sunday
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.weekday] }),
    check("site_hours_weekday", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("site_hours_order", sql`${t.closesAt} > ${t.opensAt}`),
    sameSchool(t, t.siteId, site).onDelete("cascade"),
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
  (t) => [sameSchoolTarget(t), sameSchool(t, t.siteId, site)],
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
    sameSchoolTarget(t),
  ],
);

/**
 * A quarter of a season (#291): a period a quarterly package is sold and cashed by. Data of
 * each season (Paramètres › Saisons), three by default (`defaultQuarters`); within the season,
 * never two overlapping (checked by `quartersRefusal` under a lock on the season row).
 */
export const seasonQuarter = pgTable(
  "season_quarter",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    seasonId: uuid("season_id").notNull(),
    label: text("label").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
  },
  (t) => [
    check("season_quarter_dates", sql`${t.endDate} >= ${t.startDate}`),
    check("season_quarter_label", sql`btrim(${t.label}) <> ''`),
    index().on(t.seasonId, t.startDate),
    sameSchoolTarget(t),
    sameSchool(t, t.seasonId, season).onDelete("cascade"),
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
    scope: closureScope("scope").notNull().default("school"),
  },
  (t) => [sameSchoolTarget(t), sameSchool(t, t.seasonId, season)],
);

/** Sites closed by a closure of scope « sites » (#200). */
export const closureSite = pgTable(
  "closure_site",
  {
    schoolId: schoolIdColumn(),
    closureId: uuid("closure_id").notNull(),
    siteId: uuid("site_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.closureId, t.siteId] }),
    index().on(t.siteId),
    sameSchool(t, t.closureId, closure).onDelete("cascade"),
    sameSchool(t, t.siteId, site).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// People and relationships (no more « famille »: see #67)
// ---------------------------------------------------------------------------
/**
 * Anyone known to the school: student, parent, partner, emergency
 * contact, or professional payer (company, CSE). An adult on their own is both
 * student and payer: no « famille » to create.
 */
export const person = pgTable(
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    type: personType("type").notNull().default("individual"),
    lastName: text("last_name").notNull(),
    firstName: text("first_name"),
    companyName: text("company_name"),
    siren: char("siren", { length: 9 }),
    birthDate: date("birth_date"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    notes: text("notes"), // health, instructions: visible to the front desk and management
    // Student of the school (dancer); otherwise contact: parent, payer, organisation.
    isStudent: boolean("is_student").notNull().default(false),
    toolRef: text("tool_ref"), // customer id in the invoicing tool
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("person_company_siren", sql`${t.type} = 'individual' OR ${t.siren} IS NOT NULL`),
    index().on(t.schoolId, t.lastName),
    sameSchoolTarget(t),
  ],
);

/**
 * Directed relationship: `person_id` is <type> of `related_person_id` (Hélène, legal
 * guardian of Zoé). A partner is recorded only once, in one direction.
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
    sameSchool(t, t.personId, person),
    sameSchool(t, t.relatedPersonId, person),
  ],
);

/**
 * A document handed in for a student (#287): one row per student and type,
 * its current state; the earlier states are in the audit log. Tracking only:
 * `file` stays empty until scans can be stored (#184).
 */
export const studentDocument = pgTable(
  "student_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    studentId: uuid("student_id").notNull(),
    type: documentType("type").notNull(),
    granted: boolean("granted").notNull().default(true),
    // NULL: recorded before #287, date unknown.
    receivedOn: date("received_on"),
    // Date written on the document (a certificate's): its validity runs from it.
    datedOn: date("dated_on"),
    validUntil: date("valid_until"),
    file: text("file"),
  },
  (t) => [unique().on(t.studentId, t.type), sameSchool(t, t.studentId, person)],
);

/**
 * Documents a school asks for (#287), one row per type it has set; a type
 * without a row follows `DEFAULT_REQUIREMENTS` (src/domain/people/documents.ts).
 */
export const documentRequirement = pgTable(
  "document_requirement",
  {
    schoolId: schoolIdColumn(),
    type: documentType("type").notNull(),
    required: boolean("required").notNull(),
    minorsOnly: boolean("minors_only").notNull(),
    validityMonths: smallint("validity_months"), // NULL: never expires
    dueWithinDays: smallint("due_within_days").notNull(), // days after the enrollment to bring it
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.schoolId, t.type] }),
    check("document_requirement_type", sql`${t.type} <> 'other'`),
    check("document_requirement_validity", sql`${t.validityMonths} BETWEEN 1 AND 120`),
    check("document_requirement_due", sql`${t.dueWithinDays} BETWEEN 0 AND 365`),
  ],
);

/**
 * Payment methods the school accepts (#293), one row per method it set; a method
 * without a row follows `DEFAULT_METHOD_SETTING` (src/domain/payments/methods.ts).
 * `desk_hint`: guidance shown at the desk next to the method (« règlement de la totalité »).
 */
export const paymentMethodSetting = pgTable(
  "payment_method_setting",
  {
    schoolId: schoolIdColumn(),
    method: paymentMethod("method").notNull(),
    accepted: boolean("accepted").notNull(),
    deskHint: text("desk_hint"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.schoolId, t.method] }),
    check("payment_method_setting_hint", sql`char_length(${t.deskHint}) BETWEEN 1 AND 120`),
  ],
);

// ---------------------------------------------------------------------------
// Teachers
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
    rateCents: integer("rate_cents").notNull(), // per hour, course or month
    active: boolean("active").notNull().default(true),
    // Calendar subscription: only the SHA-256 hash of the token is kept.
    calendarTokenHash: text("calendar_token_hash").unique(),
    calendarTokenCreatedAt: timestamp("calendar_token_created_at", { withTimezone: true }),
  },
  (t) => [sameSchoolTarget(t)],
);

/**
 * Time range when an instructor is not available: entered by management, or
 * read from their calendar (busy slot only, never the content).
 */
export const unavailability = pgTable(
  "unavailability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    instructorId: uuid("instructor_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    source: unavailabilitySource("source").notNull().default("manual"),
    label: text("label"), // manual entry only
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("unavailability_end", sql`${t.endsAt} > ${t.startsAt}`),
    index().on(t.instructorId, t.startsAt),
    sameSchool(t, t.instructorId, instructor),
  ],
);

/**
 * Google or Microsoft calendar connected by an instructor: encrypted refresh
 * token (src/lib/encryption.ts), never in clear.
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
  (t) => [unique().on(t.instructorId), sameSchool(t, t.instructorId, instructor)],
);

// ---------------------------------------------------------------------------
// Offer and schedule
// ---------------------------------------------------------------------------
export const discipline = pgTable(
  "discipline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    name: text("name").notNull(),
    // Adults enrolled in it bring a medical certificate (#306); minors always do. On by default:
    // a school unticks the disciplines where adults need none (couple dances).
    adultsNeedCertificate: boolean("adults_need_certificate").notNull().default(true),
  },
  (t) => [unique().on(t.schoolId, t.name), sameSchoolTarget(t)],
);

export const course = pgTable(
  "course",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    seasonId: uuid("season_id").notNull(),
    // Business that sells the course (#299, ADR 0006): its enrollments belong to it.
    billingEntityId: uuid("billing_entity_id").notNull(),
    // How VAT applies to it (#301): kept when its instructor is replaced (#289 Q2 default).
    vatTreatmentId: uuid("vat_treatment_id").notNull(),
    disciplineId: uuid("discipline_id").notNull(),
    roomId: uuid("room_id").notNull(),
    instructorId: uuid("instructor_id").notNull(),
    type: courseType("type").notNull().default("group"),
    level: text("level"),
    ageMin: smallint("age_min"),
    ageMax: smallint("age_max"),
    recurrence: courseRecurrence("recurrence").notNull().default("weekly"),
    weekday: smallint("weekday"), // 1 = Monday; NULL for specific dates (table course_date)
    // Limited period of a regular course within the season; NULL: from the start, until the end.
    startDate: date("start_date"),
    endDate: date("end_date"),
    startTime: time("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    maxCapacity: integer("max_capacity"),
    // Instructor's pay for this course (#191); NULL: their default rate.
    instructorRateCents: integer("instructor_rate_cents"),
    // Unit of that rate: the instructor's pay mode when it was typed (#268). A later
    // change of pay mode leaves past seasons' rates in their old unit (#192 Q5).
    instructorRatePayMode: payMode("instructor_rate_pay_mode"),
    // Orders an instructor's courses: the form proposes the treatment of their last one (#301).
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("course_weekday", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("course_instructor_rate", sql`${t.instructorRateCents} >= 0`),
    check(
      "course_instructor_rate_unit",
      sql`(${t.instructorRateCents} IS NULL) = (${t.instructorRatePayMode} IS NULL)`,
    ),
    check("course_recurrence_weekday", sql`(${t.recurrence} = 'dates') = (${t.weekday} IS NULL)`),
    check("course_period", sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`),
    check("course_duration", sql`${t.durationMinutes} > 0`),
    index().on(t.seasonId, t.weekday),
    sameSchoolTarget(t),
    sameEntityTarget(t),
    sameSchool(t, t.billingEntityId, billingEntity),
    sameSchool(t, t.vatTreatmentId, vatTreatment),
    sameSchool(t, t.seasonId, season),
    sameSchool(t, t.disciplineId, discipline),
    sameSchool(t, t.roomId, room),
    sameSchool(t, t.instructorId, instructor),
  ],
);

/** Dates of a one-off course (recurrence « dates »: workshop, exceptional course). */
export const courseDate = pgTable(
  "course_date",
  {
    schoolId: schoolIdColumn(),
    courseId: uuid("course_id").notNull(),
    date: date("date").notNull(),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.date] }), sameSchool(t, t.courseId, course).onDelete("cascade")],
);

/** Courses cancelled by a closure of scope « courses » (#200). */
export const closureCourse = pgTable(
  "closure_course",
  {
    schoolId: schoolIdColumn(),
    closureId: uuid("closure_id").notNull(),
    courseId: uuid("course_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.closureId, t.courseId] }),
    index().on(t.courseId),
    sameSchool(t, t.closureId, closure).onDelete("cascade"),
    sameSchool(t, t.courseId, course).onDelete("cascade"),
  ],
);

export const lesson = pgTable(
  "lesson",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    courseId: uuid("course_id").notNull(),
    date: date("date").notNull(),
    // Moved lesson (#90): its original date, which serves as the reference for lesson generation.
    plannedDate: date("planned_date"),
    // Time and duration specific to the lesson (moved, or frozen before a slot change); NULL: the course's.
    startTime: time("start_time"),
    durationMinutes: integer("duration_minutes"),
    status: lessonStatus("status").notNull().default("planned"),
    instructorId: uuid("instructor_id").notNull(), // possible substitute
    // The course's main instructor when the lesson was given, stamped on past lessons when the course
    // changes hands (#310); NULL: the course's. Statements pay a lesson on it, not on the current course.
    regularInstructorId: uuid("regular_instructor_id"),
  },
  (t) => [
    unique().on(t.courseId, t.date),
    index().on(t.schoolId, t.date),
    index().on(t.instructorId, t.date),
    index().on(t.regularInstructorId),
    sameSchoolTarget(t),
    sameSchool(t, t.courseId, course),
    sameSchool(t, t.instructorId, instructor),
    sameSchool(t, t.regularInstructorId, instructor),
  ],
);

/**
 * What a lesson removed by a closure had of its own (#206): its substitute,
 * its own time, its new date if it was moved. Kept by `syncLessons` only
 * for such lessons (decisions in `domain/schedule/lesson-sync.ts`), and used
 * to give the lesson back as it was when the closure no longer covers it.
 * Keyed like the sync: course + reference date (the original date of a
 * moved lesson, otherwise its date); the other columns are the lesson's
 * own, copied as they were.
 */
export const suspendedLesson = pgTable(
  "suspended_lesson",
  {
    schoolId: schoolIdColumn(),
    courseId: uuid("course_id").notNull(),
    referenceDate: date("reference_date").notNull(),
    date: date("date").notNull(),
    plannedDate: date("planned_date"),
    startTime: time("start_time"),
    durationMinutes: integer("duration_minutes"),
    // The substitute, if any; the main instructor is the course's at the time the lesson comes back.
    instructorId: uuid("instructor_id"),
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.referenceDate] }),
    index().on(t.instructorId),
    sameSchool(t, t.courseId, course).onDelete("cascade"),
    sameSchool(t, t.instructorId, instructor),
  ],
);

/**
 * One row per form submission that creates records (payment, enrollment,
 * course, lesson pack), keyed by an id the browser generates once (#260): a retry after a
 * lost response finds the row and gets the first result back instead of
 * creating a duplicate. Rows older than a week are purged (#262,
 * `npm run submissions:purge`).
 */
export const submission = pgTable(
  "submission",
  {
    schoolId: schoolIdColumn(),
    key: uuid("key").notNull(),
    kind: text("kind").notNull(),
    // Fingerprint of what was sent: the same key with other values is refused, not replayed.
    requestHash: text("request_hash").notNull(),
    // Technical ids only (created records, planning link), never personal data.
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.schoolId, t.key] }),
    check("submission_kind", sql`${t.kind} IN ('payment', 'enrollment', 'course', 'lesson_pack')`),
    check("submission_request_hash", sql`length(${t.requestHash}) = 64`),
    // The purge of old keys (#262) reads one school's oldest rows.
    index().on(t.schoolId, t.createdAt),
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
    sameSchool(t, t.lessonId, lesson),
    sameSchool(t, t.studentId, person),
  ],
);

// ---------------------------------------------------------------------------
// Tariffs and discounts
// ---------------------------------------------------------------------------
/** One row per grid cell: audience × periodicity × combination of courses (× discipline). */
export const tariff = pgTable(
  "tariff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    seasonId: uuid("season_id").notNull(),
    audience: tariffAudience("audience").notNull(),
    period: period("period").notNull(),
    // Durations of the week's courses, in minutes, sorted: {45,45,60} = « 45 min + 45 min + 1 h 00 ».
    combination: smallint("combination").array().notNull(),
    // Package restricted to one discipline (e.g. « Zumba 2 h 00 »); NULL = all disciplines.
    disciplineId: uuid("discipline_id"),
    priceCents: integer("price_cents").notNull(),
  },
  (t) => [
    // NULLS NOT DISTINCT: two identical « toutes disciplines » rows are refused.
    unique("tariff_cell_unique").on(t.seasonId, t.audience, t.period, t.combination, t.disciplineId).nullsNotDistinct(),
    check("tariff_combination", sql`cardinality(${t.combination}) >= 1 AND 0 < ALL(${t.combination})`),
    sameSchoolTarget(t),
    sameSchool(t, t.seasonId, season),
    sameSchool(t, t.disciplineId, discipline),
  ],
);

export const discount = pgTable(
  "discount",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    seasonId: uuid("season_id").notNull(),
    code: text("code").notNull(), // discount type known to the tariff engine: 'fratrie'
    rateBps: integer("rate_bps"), // 1000 = 10 %
    amountCents: integer("amount_cents"),
    notCombinableWith: text("not_combinable_with")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Minimum number of eligible students of the same payer (siblings: 2).
    minStudents: smallint("min_students").notNull().default(1),
    // Eligible audiences; empty = all.
    audiences: tariffAudience("audiences")
      .array()
      .notNull()
      .default(sql`'{}'::tariff_audience[]`),
    // false: excluded on a package whose courses span at least 2 disciplines.
    combinableWithMultiDiscipline: boolean("combinable_with_multi_discipline").notNull().default(true),
  },
  (t) => [
    unique().on(t.seasonId, t.code),
    check("discount_value", sql`${t.rateBps} IS NOT NULL OR ${t.amountCents} IS NOT NULL`),
    sameSchool(t, t.seasonId, season),
  ],
);

/**
 * Grid of private-lesson packs: one row per number of lessons
 * and band of people (« jusqu'à max_people »). Beyond the last
 * band: quote, price entered on the lesson pack.
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
    sameSchool(t, t.seasonId, season),
  ],
);

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------
/** A package paid by a payer; may cover two students (couple rate). */
export const enrollment = pgTable(
  "enrollment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    payerId: uuid("payer_id").notNull(),
    seasonId: uuid("season_id").notNull(),
    // Business that sells it (#299): the entity of every course of the enrollment.
    billingEntityId: uuid("billing_entity_id").notNull(),
    tariffId: uuid("tariff_id"),
    // Chosen audience and periodicity: needed to recompute the siblings discount
    // with the existing enrollments, even without a selected tariff (manual price).
    audience: tariffAudience("audience").notNull(),
    period: period("period").notNull(),
    status: enrollmentStatus("status").notNull().default("active"),
    enrolledOn: date("enrolled_on").notNull().defaultNow(),
    // Day of the drop-out (#284): the student stays on attendance sheets up to this day included.
    // Only on a dropped enrollment; NULL on a drop-out written before #284.
    droppedOn: date("dropped_on"),
    // Grid price and its discounts, as computed by the tariff engine. Without a package in the
    // grid for the courses (price typed by hand, #292), the typed price and no discount.
    // With a typed price, both (and `discounts`) are for information only: what is owed and
    // invoiced is `net_price_cents`, with no discount line (#292 Q2).
    grossPriceCents: integer("gross_price_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    // Price typed by the front desk instead of the computed one (#292), with its reason: the
    // final price, the siblings discount does not apply to it (Q2 default). NULL: the grid's.
    manualPriceCents: integer("manual_price_cents"),
    priceReason: text("price_reason"),
    // What the enrollment costs: `savedNetPrice` in `domain/enrollment/manual-price.ts`.
    netPriceCents: integer("net_price_cents").generatedAlwaysAs(
      sql`coalesce(manual_price_cents, gross_price_cents - discount_cents)`,
    ),
    discounts: text("discounts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("enrollment_dropped_on", sql`${t.droppedOn} IS NULL OR ${t.status} = 'dropped'`),
    // A typed price always has its reason, never blank (#292), and is never negative.
    check(
      "enrollment_manual_price",
      sql`(${t.manualPriceCents} IS NULL) = (${t.priceReason} IS NULL) AND (${t.manualPriceCents} IS NULL OR ${t.manualPriceCents} >= 0) AND (${t.priceReason} IS NULL OR btrim(${t.priceReason}) <> '')`,
    ),
    index().on(t.payerId, t.seasonId),
    sameSchoolTarget(t),
    sameEntityTarget(t),
    sameSchool(t, t.billingEntityId, billingEntity),
    sameSchool(t, t.payerId, person),
    sameSchool(t, t.seasonId, season),
    sameSchool(t, t.tariffId, tariff),
  ],
);

export const enrollmentCourse = pgTable(
  "enrollment_course",
  {
    schoolId: schoolIdColumn(),
    // The enrollment's entity, which must be the course's (#299): a package never mixes two businesses.
    billingEntityId: uuid("billing_entity_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    studentId: uuid("student_id").notNull(),
    courseId: uuid("course_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.enrollmentId, t.studentId, t.courseId] }),
    sameEntity(t, t.enrollmentId, enrollment),
    sameSchool(t, t.studentId, person),
    sameEntity(t, t.courseId, course),
  ],
);

/**
 * Quarters a quarterly enrollment covers (#291), set when it is saved: by default the
 * remaining ones from its enrollment day (`coveredQuarters`). What it owes is its net price
 * once per covered quarter (`seasonDueCents`). A quarter covered by an enrollment cannot be
 * removed from its season.
 */
export const enrollmentQuarter = pgTable(
  "enrollment_quarter",
  {
    schoolId: schoolIdColumn(),
    enrollmentId: uuid("enrollment_id").notNull(),
    quarterId: uuid("quarter_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.enrollmentId, t.quarterId] }),
    index().on(t.quarterId),
    sameSchool(t, t.enrollmentId, enrollment).onDelete("cascade"),
    sameSchool(t, t.quarterId, seasonQuarter),
  ],
);

/**
 * Private lessons: a purchased lesson pack, price frozen at purchase (`lesson_pack_tariff` grid
 * or quote). Numbers of lessons and people: school data, no limit here.
 */
export const lessonPack = pgTable(
  "lesson_pack",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    payerId: uuid("payer_id").notNull(),
    // Business that sells the pack (#299); the school's default entity until the sale form offers a choice.
    billingEntityId: uuid("billing_entity_id").notNull(),
    // How VAT applies to it (#301): its entity's default treatment when sold.
    vatTreatmentId: uuid("vat_treatment_id").notNull(),
    peopleCount: smallint("people_count").notNull(),
    lessonCount: smallint("lesson_count").notNull(),
    priceCents: integer("price_cents").notNull(),
    purchasedOn: date("purchased_on").notNull().defaultNow(),
  },
  (t) => [
    check("lesson_pack_people", sql`${t.peopleCount} >= 1 AND ${t.lessonCount} >= 1`),
    check("lesson_pack_price", sql`${t.priceCents} >= 0`),
    sameSchoolTarget(t),
    sameEntityTarget(t),
    sameSchool(t, t.billingEntityId, billingEntity),
    sameSchool(t, t.vatTreatmentId, vatTreatment),
    sameSchool(t, t.payerId, person),
  ],
);

/**
 * Students named on a lesson pack (#286): the private lessons of any of them can be
 * counted on it (#286 Q3 default, `usageRefusal`: one usage per lesson and student). The pack's
 * `people_count` may be larger: a guest from outside the school is not named.
 */
export const lessonPackPerson = pgTable(
  "lesson_pack_person",
  {
    schoolId: schoolIdColumn(),
    lessonPackId: uuid("lesson_pack_id").notNull(),
    personId: uuid("person_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.lessonPackId, t.personId] }),
    index().on(t.personId),
    sameSchool(t, t.lessonPackId, lessonPack).onDelete("cascade"),
    sameSchool(t, t.personId, person),
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
    sameSchool(t, t.lessonPackId, lessonPack),
    sameSchool(t, t.lessonId, lesson),
  ],
);

// ---------------------------------------------------------------------------
// Invoicing and payments
// ---------------------------------------------------------------------------
export const invoice = pgTable(
  "invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    billingEntityId: uuid("billing_entity_id").notNull(), // the issuer (ADR 0006)
    payerId: uuid("payer_id").notNull(),
    // Season it bills (#302): one draft per payer, entity and season. NULL: an invoice of no
    // season (a credit note may carry its invoice's).
    seasonId: uuid("season_id"),
    // A draft (`to_send`) has no number; an issued invoice is frozen (trigger
    // `invoice_issued_immutable`): only a credit note corrects it.
    status: invoiceStatus("status").notNull().default("to_send"),
    tool: invoicingTool("tool"),
    toolRef: text("tool_ref"),
    number: text("number"), // returned by the tool, never entered here
    issuedOn: date("issued_on"),
    totalExclTaxCents: integer("total_excl_tax_cents").notNull().default(0),
    totalVatCents: integer("total_vat_cents").notNull().default(0),
    totalInclTaxCents: integer("total_incl_tax_cents").notNull().default(0),
    creditNoteOf: uuid("credit_note_of"),
    pdfUrl: text("pdf_url"),
    // Outbox (#304, ADR 0007): attempts so far (counted when a run claims the invoice, never
    // decreasing: a draft attempted once may be in the tool and is never drafted again), the
    // claim's end (another run skips it until then), the earliest next attempt (backoff), and
    // the last failure as a technical kind and code (never a tool's text: no personal data).
    attempts: smallint("attempts").notNull().default(0),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sendErrorKind: text("send_error_kind"),
    sendErrorCode: text("send_error_code"),
    // VAT-inclusive total of the document the tool issued, as it answered (#303): differs from
    // ours on a `total_mismatch`, the amount a correcting credit note starts from.
    toolTotalInclTaxCents: integer("tool_total_incl_tax_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Each entity has its own numbering in its own tool: « A-1 » may exist once per entity.
    unique("invoice_billing_entity_id_number_unique").on(t.billingEntityId, t.number),
    // The number comes from the tool when it issues the invoice: never on a draft, always once issued.
    check(
      "invoice_number_status",
      sql`(${t.status} <> 'to_send' OR ${t.number} IS NULL) AND (${t.status} <> 'issued' OR (${t.number} IS NOT NULL AND ${t.issuedOn} IS NOT NULL))`,
    ),
    // A « TEST- » number comes from the fake tool only, and the fake tool gives no other (#303):
    // a simulated invoice never passes for a real one. `tool::text`: the enum value is new in
    // the same migration transaction, where it cannot be used as a literal yet.
    check(
      "invoice_fake_number",
      sql`${t.number} IS NULL OR (left(${t.number}, ${sql.raw(String(FAKE_NUMBER_PREFIX.length))}) = ${sql.raw(`'${FAKE_NUMBER_PREFIX}'`)}) = (coalesce(${t.tool}::text, '') = 'fake')`,
    ),
    // At most one unsent draft per payer, entity and season (#302): drafting again replaces it.
    // A draft the outbox already attempted (#304) is no longer unsent: a new one may join it.
    uniqueIndex("invoice_one_draft")
      .on(t.schoolId, t.payerId, t.billingEntityId, t.seasonId)
      .where(
        sql`${t.status} = 'to_send' AND ${t.attempts} = 0 AND ${t.creditNoteOf} IS NULL AND ${t.seasonId} IS NOT NULL`,
      ),
    check("invoice_attempts", sql`${t.attempts} >= 0`),
    // What the outbox picks up, per business, in the order it is due.
    index("invoice_outbox")
      .on(t.billingEntityId, t.nextAttemptAt)
      .where(sql`${t.status} IN ('to_send', 'tool_draft') AND ${t.creditNoteOf} IS NULL`),
    index().on(t.payerId),
    index().on(t.seasonId),
    sameSchoolTarget(t),
    sameEntityTarget(t),
    sameSchool(t, t.billingEntityId, billingEntity),
    sameSchool(t, t.payerId, person),
    sameSchool(t, t.seasonId, season),
    // A credit note cancels an invoice of the same entity.
    sameEntity(t, t.creditNoteOf, t),
  ],
);

export const invoiceLine = pgTable(
  "invoice_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    // The invoice's entity (#318), which must also sell the invoiced enrollment or lesson pack:
    // an invoice never bills another business's package.
    billingEntityId: uuid("billing_entity_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    label: text("label").notNull(),
    quantityThousandths: integer("quantity_thousandths").notNull().default(1000), // 1000 = 1
    unitPriceCents: integer("unit_price_cents").notNull(), // VAT-inclusive unit price (#301)
    // VAT-inclusive amount of the line: the source of truth; excl. and VAT derive from it
    // (`vatBreakdown`, #301): excl + VAT = incl.
    inclTaxCents: integer("incl_tax_cents").notNull(),
    exclTaxCents: integer("excl_tax_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    // The course's or pack's treatment, copied when the line is drafted, never read back:
    // a later change of the treatment leaves the line as invoiced.
    vatTreatmentId: uuid("vat_treatment_id").notNull(),
    vatCategory: vatCategory("vat_category").notNull(),
    vatRateBps: integer("vat_rate_bps").notNull().default(0), // 2000 = 20 %
    vatMention: text("vat_mention"), // printed on a line without VAT
    enrollmentId: uuid("enrollment_id"),
    lessonPackId: uuid("lesson_pack_id"), // NULL: workshop, rental, ticket…
  },
  (t) => [
    // Lookups by invoice, and the keys' checks when an enrollment or a pack changes or goes.
    index().on(t.invoiceId),
    index().on(t.enrollmentId),
    index().on(t.lessonPackId),
    index().on(t.vatTreatmentId),
    sameEntity(t, t.invoiceId, invoice),
    sameEntity(t, t.enrollmentId, enrollment),
    sameEntity(t, t.lessonPackId, lessonPack),
    sameSchool(t, t.vatTreatmentId, vatTreatment),
    check("invoice_line_vat_sum", sql`${t.exclTaxCents} + ${t.vatCents} = ${t.inclTaxCents}`),
    check(
      "invoice_line_vat_rate",
      sql`${t.vatRateBps} BETWEEN 0 AND 10000 AND (${t.vatCategory} = 'standard') = (${t.vatRateBps} > 0)`,
    ),
    check(
      "invoice_line_vat_mention",
      sql`${t.vatCategory} = 'standard' OR (${t.vatCents} = 0 AND coalesce(btrim(${t.vatMention}), '') <> '')`,
    ),
  ],
);

export const installment = pgTable(
  "installment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    billingEntityId: uuid("billing_entity_id").notNull(), // the invoice's
    invoiceId: uuid("invoice_id").notNull(),
    rank: smallint("rank").notNull(),
    dueDate: date("due_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: installmentStatus("status").notNull().default("upcoming"),
  },
  (t) => [
    unique().on(t.invoiceId, t.rank),
    index("installment_open")
      .on(t.schoolId, t.dueDate)
      .where(sql`${t.status} IN ('upcoming', 'partial', 'overdue')`),
    sameSchoolTarget(t),
    sameEntityTarget(t),
    sameEntity(t, t.invoiceId, invoice),
  ],
);

/** Immutable: an error or a refund = a negative payment; a refund entered by mistake is cancelled by a positive one (#346). */
export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    billingEntityId: uuid("billing_entity_id").notNull(), // the business that cashes it (ADR 0006)
    payerId: uuid("payer_id").notNull(),
    date: date("date").notNull().defaultNow(),
    amountCents: integer("amount_cents").notNull(),
    method: paymentMethod("method").notNull(),
    reference: text("reference"), // cheque number, authorisation number…
    // Bank or holder of a cheque when it is not the payer (#97).
    issuer: text("issuer"),
    // Cheque to be cashed later (handed in at enrollment, cashed each term); NULL: straight away.
    depositPlannedOn: date("deposit_planned_on"),
    // Correction: negative payment cancelling all or part of this payment.
    correctsId: uuid("corrects_id"),
    // What a reverse entry is (#272): a correction or a rejection (negative), its `reference`
    // staying the original's (cheque number); a refund paid back to the payer (#294, negative,
    // without `corrects_id`); or the cancellation of a refund entered by mistake (#346,
    // positive, `corrects_id` = the refund). The label is derived for display.
    reversalKind: reversalKind("reversal_kind"),
    enteredBy: uuid("entered_by"),
    toolSynced: boolean("tool_synced").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("payment_amount", sql`${t.amountCents} <> 0`),
    // A correction, a rejection or a refund cancellation (#346) cancels the payment in
    // `corrects_id`; a refund (#294) cancels none. The kinds are compared as text: a value
    // added to an enum cannot be named in the transaction that adds it, and a new database
    // applies every migration in one.
    check(
      "payment_reversal_kind",
      sql`coalesce(${t.reversalKind}::text <> 'refund', false) = (${t.correctsId} IS NOT NULL)`,
    ),
    // An ordinary payment and a refund cancellation are positive; a correction, a rejection
    // and a refund negative.
    check(
      "payment_sign",
      sql`(${t.reversalKind} IS NULL OR ${t.reversalKind}::text = 'refund_cancellation') = (${t.amountCents} > 0)`,
    ),
    sameSchoolTarget(t),
    sameEntityTarget(t),
    sameSchool(t, t.billingEntityId, billingEntity),
    sameSchool(t, t.payerId, person),
    sameSchool(t, t.enteredBy, member),
    // A reverse entry belongs to the entity of the payment it corrects.
    sameEntity(t, t.correctsId, t),
  ],
);

/** Methods deposited at the bank (or at ANCV) with a deposit slip (#98). */
export const depositMethod = pgEnum("deposit_method", ["cheque", "cash", "holiday_voucher"]);

/** Bank deposit: a deposit slip of cheques, cash or holiday vouchers deposited together (#98). */
export const bankDeposit = pgTable(
  "bank_deposit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    billingEntityId: uuid("billing_entity_id").notNull(), // a slip goes to one entity's bank account
    date: date("date").notNull(),
    method: depositMethod("method").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    sameSchoolTarget(t),
    sameEntityTarget(t),
    sameSchool(t, t.billingEntityId, billingEntity),
    sameSchool(t, t.createdBy, member),
  ],
);

/**
 * Payments of a deposit; a payment appears in a single deposit only (the payment,
 * immutable, is not modified). Deposit and payment share the line's entity.
 */
export const bankDepositPayment = pgTable(
  "bank_deposit_payment",
  {
    schoolId: schoolIdColumn(),
    billingEntityId: uuid("billing_entity_id").notNull(),
    bankDepositId: uuid("bank_deposit_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId] }),
    index().on(t.bankDepositId),
    sameEntity(t, t.bankDepositId, bankDeposit).onDelete("cascade"),
    sameEntity(t, t.paymentId, payment),
  ],
);

/** Part of a payment paying an installment; payment and installment share the line's entity. */
export const paymentAllocation = pgTable(
  "payment_allocation",
  {
    schoolId: schoolIdColumn(),
    billingEntityId: uuid("billing_entity_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    installmentId: uuid("installment_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId, t.installmentId] }),
    sameEntity(t, t.paymentId, payment),
    sameEntity(t, t.installmentId, installment),
  ],
);

// ---------------------------------------------------------------------------
// Instructor pay
// ---------------------------------------------------------------------------
export const instructorStatement = pgTable(
  "instructor_statement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
    instructorId: uuid("instructor_id").notNull(),
    month: date("month").notNull(), // 1st day of the month
    lessonCount: integer("lesson_count").notNull(),
    minutes: integer("minutes").notNull(),
    amountDueCents: integer("amount_due_cents").notNull(),
    invoiceReceived: text("invoice_received"),
    invoicedAmountCents: integer("invoiced_amount_cents"),
    status: statementStatus("status").notNull().default("to_check"),
  },
  (t) => [unique().on(t.instructorId, t.month), sameSchool(t, t.instructorId, instructor)],
);

// ---------------------------------------------------------------------------
// Audit log (append-only)
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
  (t) => [index().on(t.schoolId, t.targetTable, t.rowId), sameSchool(t, t.actor, member)],
);

// ---------------------------------------------------------------------------
// Authentication (Better Auth): GLOBAL tables, without school_id or RLS.
// An account can belong to several schools (`member`). Structure expected
// by Better Auth 1.7 (getAuthTables); properties in camelCase, columns in snake_case.
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
    // School chosen after sign-in, set on the server side after checking
    // membership. Not named school_id: the session is not school data.
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
    password: text("password"), // hashed by Better Auth
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId)],
);

/**
 * Recent sign-in failures, to limit password attempts
 * (src/lib/sign-in-limit.ts). The key is an HMAC of the e-mail or the IP:
 * no personal data in clear. Purged as it goes.
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
