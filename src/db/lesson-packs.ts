import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  MAX_LESSONS,
  MAX_PEOPLE,
  MAX_PRICE_CENTS,
  MAX_REASON_LENGTH,
  priceRefusal,
  saleRefusal,
  usageRefusal,
} from "../domain/lesson-pack/pack";
import { priceLessonPack } from "../domain/tariff/lesson-pack";
import { has } from "../lib/has";
import { rowsOf } from "./columns-of";
import type { Tx } from "./index";
import { displayedName, payableStudents } from "./people";
import { currentSeason } from "./schedule";
import { auditLog, course, lesson, lessonPack, lessonPackPerson, lessonPackUsage, member, person } from "./schema";
import { listLessonPacks } from "./tariffs";

/**
 * Lesson packs of private lessons (#286): sold to a payer for one or more of
 * their students, at the price of the season's grid or at another price with a
 * reason. Rules in `domain/lesson-pack/pack.ts`. Always within the `withSchool()`
 * transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: unknown) => z.uuid().safeParse(v).success;

/** What the sale form sends; `priceCents` null when nothing was typed. */
export const validSale = z.object({
  lessonCount: z.int().min(1).max(MAX_LESSONS),
  peopleCount: z.int().min(1).max(MAX_PEOPLE),
  participantIds: z.array(z.uuid()).min(1).max(MAX_PEOPLE),
  priceCents: z.int().min(0).max(MAX_PRICE_CENTS).nullable(),
  reason: z.string().max(MAX_REASON_LENGTH * 2),
});
export type SaleInput = z.input<typeof validSale>;

/** Price of the current season's grid for this pack; null when the grid has no line for it (quote). */
export async function gridPrice(
  tx: Tx,
  today: string,
  lessonCount: number,
  peopleCount: number,
): Promise<number | null> {
  if (![lessonCount, peopleCount].every((n) => Number.isInteger(n) && n >= 1)) return null;
  const season = await currentSeason(tx, today);
  if (!season) return null;
  const r = priceLessonPack(await listLessonPacks(tx, season.id), { lessonCount, peopleCount });
  return r.status === "ok" ? r.priceCents : null;
}

/** The current season's pack grid, for the sale form to show the price as the entry changes. */
export async function packGrid(tx: Tx, today: string) {
  const season = await currentSeason(tx, today);
  return season ? listLessonPacks(tx, season.id) : [];
}

export type SaleResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * Sells a pack to `payerId` for some of their students (the ones they pay for, or
 * themselves if they are a student). The grid price is recomputed here; a price
 * typed apart from it needs a reason (#286 Q4), kept in the audit log.
 */
export async function sellLessonPack(
  tx: Tx,
  userId: string,
  payerId: string,
  entry: SaleInput,
  today: string,
): Promise<SaleResult> {
  const parsed = validSale.safeParse(entry);
  if (!parsed.success || !isUuid(payerId)) return { ok: false, message: "Saisie invalide." };
  const e = parsed.data;
  const refusal = saleRefusal(e);
  if (refusal) return { ok: false, message: refusal };

  const [who] = await tx
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  if (!who) return { ok: false, message: "Accès refusé." };

  const [payer] = await tx.select({ id: person.id }).from(person).where(eq(person.id, payerId));
  if (!payer) return { ok: false, message: "Payeur introuvable." };
  const payables = new Set((await payableStudents(tx, payerId)).map((s) => s.id));
  if (!e.participantIds.every((id) => payables.has(id)))
    return {
      ok: false,
      message: "Cette personne ne paie pas pour cet élève : ajoutez le lien « paie pour » sur sa fiche.",
    };

  const gridPriceCents = await gridPrice(tx, today, e.lessonCount, e.peopleCount);
  const reason = e.reason.trim();
  const priceProblem = priceRefusal({ gridPriceCents, priceCents: e.priceCents, reason }, who.role);
  if (priceProblem) return { ok: false, message: priceProblem };
  // priceRefusal returned null: the price is set.
  const priceCents = e.priceCents ?? 0;
  const changed = gridPriceCents !== null && priceCents !== gridPriceCents;

  const [{ id }] = await tx
    .insert(lessonPack)
    .values({
      schoolId: CURRENT_SCHOOL,
      payerId,
      peopleCount: e.peopleCount,
      lessonCount: e.lessonCount,
      priceCents,
      purchasedOn: today,
    })
    .returning({ id: lessonPack.id });
  await tx.insert(lessonPackPerson).values(
    rowsOf(
      lessonPackPerson,
      e.participantIds.map((personId) => ({ schoolId: CURRENT_SCHOOL, lessonPackId: id, personId })),
    ),
  );
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who.id,
    targetTable: "lesson_pack",
    rowId: id,
    action: "insert",
    // Technical ids and amounts; the reason is what the member typed for a price apart from the grid.
    after: {
      payerId,
      participantIds: e.participantIds,
      lessonCount: e.lessonCount,
      peopleCount: e.peopleCount,
      priceCents,
      gridPriceCents,
      ...(changed || (gridPriceCents === null && reason) ? { reason } : {}),
    },
  });
  return { ok: true, id };
}

export type PackRow = {
  id: string;
  lessonCount: number;
  peopleCount: number;
  priceCents: number;
  purchasedOn: string;
  usedCount: number;
  payerId: string;
  payer: string;
  /** Names of the students on the pack. */
  participants: { id: string; name: string }[];
};

const usedCount = sql<number>`(SELECT count(*) FROM lesson_pack_usage u WHERE u.lesson_pack_id = ${lessonPack}.${sql.identifier("id")})::int`;

const packId = sql`${lessonPack}.${sql.identifier("id")}`;

/**
 * Packs, the most recent first: the ones paid by this person or naming them as a
 * student (`personId`), the ones counted on a lesson (`countedOn`), or every pack
 * with lessons left (`open`, a lesson's picker; Q1: no expiry).
 */
export async function packsOf(
  tx: Tx,
  of: { personId: string } | { countedOn: string } | { open: true },
): Promise<PackRow[]> {
  const where = has(of, "personId")
    ? isUuid(of.personId)
      ? or(
          eq(lessonPack.payerId, of.personId),
          sql`EXISTS (SELECT 1 FROM lesson_pack_person p WHERE p.lesson_pack_id = ${packId} AND p.person_id = ${of.personId})`,
        )
      : null
    : has(of, "countedOn")
      ? isUuid(of.countedOn)
        ? sql`EXISTS (SELECT 1 FROM lesson_pack_usage u WHERE u.lesson_pack_id = ${packId} AND u.lesson_id = ${of.countedOn})`
        : null
      : sql`${usedCount} < ${lessonPack.lessonCount}`;
  if (!where) return [];
  const packs = await tx
    .select({
      id: lessonPack.id,
      lessonCount: lessonPack.lessonCount,
      peopleCount: lessonPack.peopleCount,
      priceCents: lessonPack.priceCents,
      purchasedOn: lessonPack.purchasedOn,
      usedCount,
      payerId: lessonPack.payerId,
      payerName: person.lastName,
      payerFirstName: person.firstName,
      payerCompany: person.companyName,
    })
    .from(lessonPack)
    .innerJoin(person, eq(person.id, lessonPack.payerId))
    .where(where)
    .orderBy(desc(lessonPack.purchasedOn), asc(lessonPack.id));
  if (packs.length === 0) return [];
  const named = await tx
    .select({
      packId: lessonPackPerson.lessonPackId,
      id: person.id,
      name: person.lastName,
      firstName: person.firstName,
      companyName: person.companyName,
    })
    .from(lessonPackPerson)
    .innerJoin(person, eq(person.id, lessonPackPerson.personId))
    .where(
      inArray(
        lessonPackPerson.lessonPackId,
        packs.map((p) => p.id),
      ),
    )
    .orderBy(asc(person.firstName), asc(person.lastName));
  return packs.map(({ payerName, payerFirstName, payerCompany, ...p }) => ({
    ...p,
    payer: displayedName({ name: payerName, firstName: payerFirstName, companyName: payerCompany }),
    participants: named.filter((n) => n.packId === p.id).map((n) => ({ id: n.id, name: displayedName(n) })),
  }));
}

// ---------------------------------------------------------------------------
// Counting private lessons on a pack (#286, PR 2)
// ---------------------------------------------------------------------------

export type UsageResult = { ok: true; already?: true } | { ok: false; message: string };

const NO_LESSON = "Cette séance n’existe plus.";
const NO_PACK = "Ce carnet n’existe plus.";

/** The acting member of the current school, for the audit log. */
async function memberOf(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m?.id ?? null;
}

/**
 * Counts `lessonId` on `packId` (rules in `usageRefusal`). The pack's row is locked
 * first, until the end of the transaction: two counts on the same pack at the same
 * moment run one after the other, and the second sees the first's usage, so a pack
 * is never over-used. NO KEY UPDATE, not UPDATE: the usage's foreign key to the pack
 * takes KEY SHARE, which UPDATE would block. The usages are counted in a statement of
 * their own, after the lock, so that it sees a count committed meanwhile. The same
 * count sent twice changes nothing.
 */
export async function countLesson(
  tx: Tx,
  userId: string,
  lessonId: string,
  lessonPackId: string,
): Promise<UsageResult> {
  if (!isUuid(lessonId)) return { ok: false, message: NO_LESSON };
  if (!isUuid(lessonPackId)) return { ok: false, message: NO_PACK };
  const [locked] = await tx
    .select({ id: lessonPack.id, lessonCount: lessonPack.lessonCount })
    .from(lessonPack)
    .where(eq(lessonPack.id, lessonPackId))
    .for("no key update");
  if (!locked) return { ok: false, message: NO_PACK };
  const [l] = await tx
    .select({ status: lesson.status, courseType: course.type })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(eq(lesson.id, lessonId))
    // A cancellation at the same moment (`cancelLesson`, NO KEY UPDATE) is waited for and its status read.
    .for("share", { of: lesson });
  if (!l) return { ok: false, message: NO_LESSON };
  const counted = await tx
    .select({ lessonId: lessonPackUsage.lessonId })
    .from(lessonPackUsage)
    .where(eq(lessonPackUsage.lessonPackId, lessonPackId));
  if (counted.some((u) => u.lessonId === lessonId)) return { ok: true, already: true };
  const refusal = usageRefusal({
    courseType: l.courseType,
    lessonStatus: l.status,
    pack: { lessonCount: locked.lessonCount, usedCount: counted.length },
  });
  if (refusal) return { ok: false, message: refusal };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  await tx.insert(lessonPackUsage).values({ schoolId: CURRENT_SCHOOL, lessonPackId, lessonId });
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
    targetTable: "lesson_pack_usage",
    rowId: lessonPackId,
    action: "insert",
    after: { lessonPackId, lessonId },
  });
  return { ok: true };
}

/**
 * « Annuler le décompte »: gives the lesson back to the pack; the audit log keeps the
 * count and its removal. Undoing a count already undone changes nothing.
 */
export async function uncountLesson(
  tx: Tx,
  userId: string,
  lessonId: string,
  lessonPackId: string,
): Promise<UsageResult> {
  if (!isUuid(lessonId) || !isUuid(lessonPackId)) return { ok: false, message: NO_LESSON };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const removed = await tx
    .delete(lessonPackUsage)
    .where(and(eq(lessonPackUsage.lessonPackId, lessonPackId), eq(lessonPackUsage.lessonId, lessonId)))
    .returning({ lessonId: lessonPackUsage.lessonId });
  if (removed.length === 0) return { ok: true, already: true };
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
    targetTable: "lesson_pack_usage",
    rowId: lessonPackId,
    action: "delete",
    before: { lessonPackId, lessonId },
  });
  return { ok: true };
}

export type LessonPacks = {
  /** Packs this lesson is counted on. */
  counted: PackRow[];
  /** Packs it can be counted on: open, not counted on it yet; the ones naming a student of the lesson first. */
  offered: (PackRow & { ofLesson: boolean })[];
};

/**
 * What a private lesson's « Carnet » panel shows. Every open pack is offered (a private
 * course often has no enrollment to tell its students), the ones naming a student on
 * the lesson's sheet first.
 */
export async function lessonPacks(tx: Tx, lessonId: string, studentIds: readonly string[]): Promise<LessonPacks> {
  const counted = await packsOf(tx, { countedOn: lessonId });
  const countedIds = new Set(counted.map((p) => p.id));
  const students = new Set(studentIds);
  const offered = (await packsOf(tx, { open: true }))
    .filter((p) => !countedIds.has(p.id))
    .map((p) => ({ ...p, ofLesson: p.participants.some((s) => students.has(s.id)) }))
    .sort((a, b) => Number(b.ofLesson) - Number(a.ofLesson));
  return { counted, offered };
}
