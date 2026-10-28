/**
 * Multi-school data model (SaaS) – Drizzle ORM / PostgreSQL
 *
 * Conventions
 *  - Every business table carries `school_id`: isolation between schools is
 *    guaranteed by Row Level Security (see migrations/0001_rls.sql).
 *  - Amounts in integer CENTS (`*_cents`), rates in basis points
 *    (2000 = 20 %): no floating-point number on the TypeScript side.
 *  - The invoice number is provided by the school's invoicing tool.
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
  uuid,
} from "drizzle-orm/pg-core";
import { ROLE_VALUES } from "../domain/team/rules";

// ---------------------------------------------------------------------------
// Enumerated types
// ---------------------------------------------------------------------------
export const personType = pgEnum("person_type", ["individual", "organisation"]);
export const relationshipType = pgEnum("relationship_type", ["legal_guardian", "partner", "other"]);
export const documentType = pgEnum("document_type", [
  "medical_certificate",
  "parental_consent",
  "image_rights",
  "other",
]);
export const instructorStatus = pgEnum("instructor_status", ["sole_trader", "company", "employee"]);
export const vatRegime = pgEnum("vat_regime", ["franchise_293b", "vat_registered", "not_applicable"]);
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
export const invoicingTool = pgEnum("invoicing_tool", ["pennylane", "abby", "shine"]);
export const paymentMethod = pgEnum("payment_method", [
  "cheque",
  "cash",
  "card",
  "transfer",
  "direct_debit",
  "holiday_voucher",
  "pass_sport",
  "other",
]);
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
  companyName: text("company_name"),
  siren: char("siren", { length: 9 }),
  vatRegime: vatRegime("vat_regime").notNull().default("not_applicable"),
  vatMention: text("vat_mention"), // e.g. « TVA non applicable, art. 293 B du CGI »
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

/** Invoicing connector configuration, one per school. */
export const invoicingConnector = pgTable("invoicing_connector", {
  schoolId: uuid("school_id")
    .primaryKey()
    .references(() => school.id, { onDelete: "cascade" }),
  tool: invoicingTool("tool").notNull(),
  encryptedCredentials: text("encrypted_credentials").notNull(), // encrypted on the application side
  oneConnectEnabled: boolean("one_connect_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  (t) => [sameSchool(t, t.studentId, person)],
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
  },
  (t) => [unique().on(t.schoolId, t.name), sameSchoolTarget(t)],
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
    // Instructor's pay for this course, in the unit of their pay mode (#191); NULL: their default rate.
    instructorRateCents: integer("instructor_rate_cents"),
  },
  (t) => [
    check("course_weekday", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("course_instructor_rate", sql`${t.instructorRateCents} >= 0`),
    check("course_recurrence_weekday", sql`(${t.recurrence} = 'dates') = (${t.weekday} IS NULL)`),
    check("course_period", sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`),
    check("course_duration", sql`${t.durationMinutes} > 0`),
    index().on(t.seasonId, t.weekday),
    sameSchoolTarget(t),
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
  },
  (t) => [
    unique().on(t.courseId, t.date),
    index().on(t.schoolId, t.date),
    index().on(t.instructorId, t.date),
    sameSchoolTarget(t),
    sameSchool(t, t.courseId, course),
    sameSchool(t, t.instructorId, instructor),
  ],
);

/**
 * What a lesson removed by a closure had of its own (#206): its substitute,
 * its own time, its new date if it was moved. Kept by `syncLessons` only
 * for such lessons, and used to give the lesson back as it was when the
 * closure no longer covers it. Keyed like the sync: course + reference date
 * (the original date of a moved lesson, otherwise its date); the other
 * columns are the lesson's own, copied as they were.
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
    instructorId: uuid("instructor_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.referenceDate] }),
    index().on(t.instructorId),
    sameSchool(t, t.courseId, course).onDelete("cascade"),
    sameSchool(t, t.instructorId, instructor).onDelete("cascade"),
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
    tariffId: uuid("tariff_id"),
    // Chosen audience and periodicity: needed to recompute the siblings discount
    // with the existing enrollments, even without a selected tariff (manual price).
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
    sameSchoolTarget(t),
    sameSchool(t, t.payerId, person),
    sameSchool(t, t.seasonId, season),
    sameSchool(t, t.tariffId, tariff),
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
    sameSchool(t, t.enrollmentId, enrollment),
    sameSchool(t, t.studentId, person),
    sameSchool(t, t.courseId, course),
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
    peopleCount: smallint("people_count").notNull(),
    lessonCount: smallint("lesson_count").notNull(),
    priceCents: integer("price_cents").notNull(),
    purchasedOn: date("purchased_on").notNull().defaultNow(),
  },
  (t) => [
    check("lesson_pack_people", sql`${t.peopleCount} >= 1 AND ${t.lessonCount} >= 1`),
    sameSchoolTarget(t),
    sameSchool(t, t.payerId, person),
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
    payerId: uuid("payer_id").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.schoolId, t.number),
    index().on(t.payerId),
    sameSchoolTarget(t),
    sameSchool(t, t.payerId, person),
    sameSchool(t, t.creditNoteOf, t),
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
    lessonPackId: uuid("lesson_pack_id"), // NULL: workshop, rental, ticket…
  },
  (t) => [
    sameSchool(t, t.invoiceId, invoice),
    sameSchool(t, t.enrollmentId, enrollment),
    sameSchool(t, t.lessonPackId, lessonPack),
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
    status: installmentStatus("status").notNull().default("upcoming"),
  },
  (t) => [
    unique().on(t.invoiceId, t.rank),
    index("installment_open")
      .on(t.schoolId, t.dueDate)
      .where(sql`${t.status} IN ('upcoming', 'partial', 'overdue')`),
    sameSchoolTarget(t),
    sameSchool(t, t.invoiceId, invoice),
  ],
);

/** Immutable: an error or a refund = a negative payment. */
export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolIdColumn(),
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
    enteredBy: uuid("entered_by"),
    toolSynced: boolean("tool_synced").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("payment_amount", sql`${t.amountCents} <> 0`),
    sameSchoolTarget(t),
    sameSchool(t, t.payerId, person),
    sameSchool(t, t.enteredBy, member),
    sameSchool(t, t.correctsId, t),
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
    date: date("date").notNull(),
    method: depositMethod("method").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [sameSchoolTarget(t), sameSchool(t, t.createdBy, member)],
);

/** Payments of a deposit; a payment appears in a single deposit only (the payment, immutable, is not modified). */
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
    sameSchool(t, t.bankDepositId, bankDeposit).onDelete("cascade"),
    sameSchool(t, t.paymentId, payment),
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
    sameSchool(t, t.paymentId, payment),
    sameSchool(t, t.installmentId, installment),
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
