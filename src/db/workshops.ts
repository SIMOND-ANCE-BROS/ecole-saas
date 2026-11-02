import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ATTENDANCE_TAKEN,
  MAX_PARTICIPANTS,
  MAX_PRICE_CENTS,
  MAX_REASON_LENGTH,
  signupDueCents,
  signupPriceDiffers,
  signupPriceRefusal,
  signupRefusal,
} from "../domain/workshop/signup";
import { displayedName } from "../domain/people/name";
import { rowsOf } from "./columns-of";
import type { Tx } from "./index";
import { lockCourses } from "./attendance-locks";
import { NOT_A_STUDENT_YET, payableStudents, paysForNonStudent } from "./people";
import { courseDatesSql } from "./courses";
import { headcountSql } from "./schedule";
import {
  auditLog,
  billingEntity,
  course,
  discipline,
  member,
  person,
  season,
  workshopSignup,
  workshopSignupPerson,
} from "./schema";

/**
 * Workshop sign-ups (#297): a payer signs some of their students up for a workshop (a course of
 * type `workshop`), at its price per participant or another one with a reason. Rules in
 * `domain/workshop/signup.ts`. Always within the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

/** What the sign-up form sends; `priceCents` per participant, null when nothing was typed. */
export const validSignup = z.object({
  courseId: z.uuid(),
  participantIds: z.array(z.uuid()).min(1).max(MAX_PARTICIPANTS),
  priceCents: z.int().min(0).max(MAX_PRICE_CENTS).nullable(),
  reason: z.string().max(MAX_REASON_LENGTH * 2),
});
export type SignupInput = z.input<typeof validSignup>;

/** Participants of a workshop (any payer), counted as on its record (#398). */
const participantsSql = headcountSql(sql`${course}.${sql.identifier("id")}`);

export type WorkshopChoice = {
  id: string;
  label: string;
  /** Its dates, sorted (`YYYY-MM-DD`); empty for a workshop given weekly. */
  dates: string[];
  startTime: string;
  durationMinutes: number;
  /** Price per participant set on it; null when none. */
  priceCents: number | null;
  maxCapacity: number | null;
  participants: number;
  /** Business that sells it, shown when the school has several. */
  entity: string;
};

/** The label of a workshop: its discipline, and its level when it has one. */
const workshopLabel = (w: { discipline: string; level: string | null }) =>
  w.level ? `${w.discipline} — ${w.level}` : w.discipline;

/**
 * Workshops of the seasons not ended yet, as the sign-up form offers them: the coming ones first,
 * the soonest first, then the past ones, the latest first (a sign-up entered late).
 */
export async function workshopChoices(tx: Tx, today: string): Promise<WorkshopChoice[]> {
  const rows = await tx
    .select({
      id: course.id,
      discipline: discipline.name,
      level: course.level,
      dates: courseDatesSql,
      startDate: course.startDate,
      endDate: course.endDate,
      seasonStart: season.startDate,
      seasonEnd: season.endDate,
      startTime: course.startTime,
      durationMinutes: course.durationMinutes,
      priceCents: course.workshopPriceCents,
      maxCapacity: course.maxCapacity,
      participants: participantsSql,
      entity: billingEntity.name,
    })
    .from(course)
    .innerJoin(season, eq(season.id, course.seasonId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(billingEntity, eq(billingEntity.id, course.billingEntityId))
    .where(and(eq(course.type, "workshop"), gte(season.endDate, today)))
    .orderBy(asc(season.startDate), asc(discipline.name), asc(course.id));
  // Past once its last date is: a workshop of several dates stays coming until then.
  const first = (r: (typeof rows)[number]) =>
    (r.dates.at(-1) ?? r.endDate ?? r.seasonEnd) < today
      ? (r.dates.at(-1) ?? r.endDate ?? r.seasonEnd)
      : (r.dates.find((d) => d >= today) ?? r.startDate ?? r.seasonStart);
  return rows
    .map((r) => ({
      id: r.id,
      label: workshopLabel(r),
      dates: r.dates,
      startTime: r.startTime.slice(0, 5),
      durationMinutes: r.durationMinutes,
      priceCents: r.priceCents,
      maxCapacity: r.maxCapacity,
      participants: r.participants,
      entity: r.entity,
      sortKey: first(r),
    }))
    .sort((a, b) => {
      const pastA = a.sortKey < today;
      const pastB = b.sortKey < today;
      if (pastA !== pastB) return pastA ? 1 : -1;
      return pastA ? b.sortKey.localeCompare(a.sortKey) : a.sortKey.localeCompare(b.sortKey);
    })
    .map(({ sortKey: _, ...w }) => w);
}

/** The acting member of the current school, with their role. */
async function memberOf(tx: Tx, userId: string) {
  const [m] = await tx
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m ?? null;
}

export type SignupResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * Signs some students of `payerId` (the ones they pay for, or themselves if they are a student)
 * up for a workshop. Its business and VAT treatment are the workshop's, frozen on the sign-up;
 * its price per participant is the workshop's, or another one with a reason kept on the sign-up
 * and in the audit log. The workshop row is locked: two sign-ups of the same student at once
 * cannot both pass.
 */
export async function signUpForWorkshop(
  tx: Tx,
  userId: string,
  payerId: string,
  entry: SignupInput,
  today: string,
): Promise<SignupResult> {
  const parsed = validSignup.safeParse(entry);
  if (!parsed.success || !isUuid(payerId)) return { ok: false, message: "Saisie invalide." };
  const e = parsed.data;

  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };

  const [w] = await tx
    .select({
      id: course.id,
      type: course.type,
      billingEntityId: course.billingEntityId,
      vatTreatmentId: course.vatTreatmentId,
      workshopPriceCents: course.workshopPriceCents,
    })
    .from(course)
    .where(eq(course.id, e.courseId))
    .for("no key update");
  if (!w || w.type !== "workshop") return { ok: false, message: "Ce stage n’existe plus." };

  const [payer] = await tx.select({ id: person.id }).from(person).where(eq(person.id, payerId));
  if (!payer) return { ok: false, message: "Payeur introuvable." };
  const payables = new Set((await payableStudents(tx, payerId)).map((s) => s.id));
  if (!e.participantIds.every((id) => payables.has(id)))
    return {
      ok: false,
      message: (await paysForNonStudent(tx, payerId, e.participantIds))
        ? NOT_A_STUDENT_YET
        : "Cette personne ne paie pas pour cet élève : ajoutez le lien « paie pour » sur sa fiche.",
    };

  const already = await tx
    .select({ id: workshopSignupPerson.personId })
    .from(workshopSignupPerson)
    .innerJoin(workshopSignup, eq(workshopSignup.id, workshopSignupPerson.workshopSignupId))
    .where(and(eq(workshopSignup.courseId, w.id), inArray(workshopSignupPerson.personId, e.participantIds)));
  const refusal = signupRefusal({ participantIds: e.participantIds, alreadySignedUp: already.map((a) => a.id) });
  if (refusal) return { ok: false, message: refusal };

  const reason = e.reason.trim();
  const priceProblem = signupPriceRefusal(
    { workshopPriceCents: w.workshopPriceCents, priceCents: e.priceCents, reason },
    who.role,
  );
  if (priceProblem) return { ok: false, message: priceProblem };
  // signupPriceRefusal returned null: the price is set.
  const unitPriceCents = e.priceCents ?? 0;
  const differs = signupPriceDiffers({ workshopPriceCents: w.workshopPriceCents, priceCents: unitPriceCents });
  // Kept when the price differs from the workshop's, or when it was typed for a workshop without one.
  const priceReason = (differs || w.workshopPriceCents === null) && reason !== "" ? reason : null;

  const [{ id }] = await tx
    .insert(workshopSignup)
    .values({
      schoolId: CURRENT_SCHOOL,
      billingEntityId: w.billingEntityId,
      courseId: w.id,
      payerId,
      vatTreatmentId: w.vatTreatmentId,
      unitPriceCents,
      priceReason,
      signedUpOn: today,
    })
    .returning({ id: workshopSignup.id });
  await tx.insert(workshopSignupPerson).values(
    rowsOf(
      workshopSignupPerson,
      e.participantIds.map((personId) => ({ schoolId: CURRENT_SCHOOL, workshopSignupId: id, personId })),
    ),
  );
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who.id,
    targetTable: "workshop_signup",
    rowId: id,
    action: "insert",
    // Technical ids and amounts; the reason is what the member typed for the price.
    after: {
      courseId: w.id,
      payerId,
      participantIds: e.participantIds,
      unitPriceCents,
      workshopPriceCents: w.workshopPriceCents,
      ...(priceReason ? { reason: priceReason } : {}),
    },
  });
  return { ok: true, id };
}

export type SignupRow = {
  id: string;
  courseId: string;
  label: string;
  dates: string[];
  unitPriceCents: number;
  /** What it owes: its price per participant once per participant. */
  dueCents: number;
  signedUpOn: string;
  payerId: string;
  payer: string;
  participants: { id: string; name: string }[];
};

const signupIdSql = sql`${workshopSignup}.${sql.identifier("id")}`;

/** Sign-ups paid by this person or naming them, the most recent workshop first. */
export async function signupsOf(tx: Tx, personId: string): Promise<SignupRow[]> {
  if (!isUuid(personId)) return [];
  const rows = await tx
    .select({
      id: workshopSignup.id,
      courseId: workshopSignup.courseId,
      discipline: discipline.name,
      level: course.level,
      dates: courseDatesSql,
      unitPriceCents: workshopSignup.unitPriceCents,
      signedUpOn: workshopSignup.signedUpOn,
      payerId: workshopSignup.payerId,
      payerName: person.lastName,
      payerFirstName: person.firstName,
      payerCompany: person.companyName,
    })
    .from(workshopSignup)
    .innerJoin(course, eq(course.id, workshopSignup.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(person, eq(person.id, workshopSignup.payerId))
    .where(
      or(
        eq(workshopSignup.payerId, personId),
        sql`EXISTS (SELECT 1 FROM workshop_signup_person p WHERE p.workshop_signup_id = ${signupIdSql} AND p.person_id = ${personId})`,
      ),
    )
    .orderBy(asc(workshopSignup.signedUpOn), asc(workshopSignup.id));
  if (rows.length === 0) return [];
  const named = await tx
    .select({
      signupId: workshopSignupPerson.workshopSignupId,
      id: person.id,
      name: person.lastName,
      firstName: person.firstName,
      companyName: person.companyName,
    })
    .from(workshopSignupPerson)
    .innerJoin(person, eq(person.id, workshopSignupPerson.personId))
    .where(
      inArray(
        workshopSignupPerson.workshopSignupId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(person.firstName), asc(person.lastName));
  return rows
    .map(({ payerName, payerFirstName, payerCompany, discipline: d, level, ...r }) => {
      const participants = named.filter((n) => n.signupId === r.id).map((n) => ({ id: n.id, name: displayedName(n) }));
      return {
        ...r,
        label: workshopLabel({ discipline: d, level }),
        dueCents: signupDueCents({ unitPriceCents: r.unitPriceCents, participantCount: participants.length }),
        payer: displayedName({ name: payerName, firstName: payerFirstName, companyName: payerCompany }),
        participants,
      };
    })
    .sort((a, b) => (b.dates[0] ?? b.signedUpOn).localeCompare(a.dates[0] ?? a.signedUpOn));
}

/** What each sign-up of a payer owes, with its business: the balance counts them (#297). */
export async function signupDuesOf(tx: Tx, payerId: string) {
  const rows = await tx
    .select({
      billingEntityId: workshopSignup.billingEntityId,
      unitPriceCents: workshopSignup.unitPriceCents,
      participantCount: sql<number>`(SELECT count(*) FROM workshop_signup_person p WHERE p.workshop_signup_id = ${signupIdSql})::int`,
    })
    .from(workshopSignup)
    .where(eq(workshopSignup.payerId, payerId));
  return rows.map((r) => ({ billingEntityId: r.billingEntityId, priceCents: signupDueCents(r) }));
}

export type CancelResult = { ok: true } | { ok: false; message: string };

/**
 * Cancels a sign-up entered by mistake: removed with its participants, the audit log keeps its
 * ids and amounts; the payer's payments are untouched and stay on the balance. What a workshop
 * the school cancels owes is an open question (#297): nothing here decides it.
 */
export async function cancelWorkshopSignup(tx: Tx, userId: string, id: string): Promise<CancelResult> {
  if (!isUuid(id)) return { ok: false, message: "Saisie invalide." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  // The workshop's course, then the sign-up (`attendance-locks.ts`, #406): attendance being saved
  // or an enrollment being cancelled meanwhile is seen by the check below. A sign-up never
  // changes course: read before the lock, it stays right under it.
  const [target] = await tx
    .select({ courseId: workshopSignup.courseId })
    .from(workshopSignup)
    .where(eq(workshopSignup.id, id));
  if (!target) return { ok: false, message: "Cette inscription au stage a déjà été annulée." };
  await lockCourses(tx, [target.courseId]);
  const [s] = await tx
    .select({
      courseId: workshopSignup.courseId,
      payerId: workshopSignup.payerId,
      billingEntityId: workshopSignup.billingEntityId,
      vatTreatmentId: workshopSignup.vatTreatmentId,
      unitPriceCents: workshopSignup.unitPriceCents,
      priceReason: workshopSignup.priceReason,
      signedUpOn: workshopSignup.signedUpOn,
    })
    .from(workshopSignup)
    .where(eq(workshopSignup.id, id))
    .for("update");
  if (!s) return { ok: false, message: "Cette inscription au stage a déjà été annulée." };
  // Attendance taken for a participant (#398), unless an enrollment in the workshop also puts them on
  // that lesson's sheet (`onAttendanceSheet`): removing the sign-up would leave that attendance off
  // every sheet, yet counted on statements.
  const [{ attended }] = await tx.execute<{ attended: boolean }>(sql`SELECT EXISTS (
      SELECT 1 FROM workshop_signup_person p
      JOIN lesson l ON l.course_id = ${s.courseId}
      JOIN attendance a ON a.lesson_id = l.id AND a.student_id = p.person_id
      WHERE p.workshop_signup_id = ${id}
        AND NOT EXISTS (
          SELECT 1 FROM enrollment_course c
          JOIN enrollment e ON e.id = c.enrollment_id
            AND (e.status IN ('active', 'trial') OR (e.status = 'dropped' AND e.dropped_on >= l.date))
          WHERE c.course_id = ${s.courseId} AND c.student_id = p.person_id
        )
    ) AS attended`);
  if (attended) return { ok: false, message: ATTENDANCE_TAKEN };
  const participants = await tx
    .select({ id: workshopSignupPerson.personId })
    .from(workshopSignupPerson)
    .where(eq(workshopSignupPerson.workshopSignupId, id));
  await tx.delete(workshopSignup).where(eq(workshopSignup.id, id));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who.id,
    targetTable: "workshop_signup",
    rowId: id,
    action: "delete",
    before: { ...s, participantIds: participants.map((p) => p.id) },
  });
  return { ok: true };
}
