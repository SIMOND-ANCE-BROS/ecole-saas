import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  normalisedRules,
  REFERRAL_SOURCES_MAX,
  referralRefusal,
  RULES_LABEL,
  RULES_TEXT_MAX,
  rulesChanged,
} from "../domain/people/internal-rules";
import { displayedName } from "../domain/people/name";
import type { Tx } from "./index";
import {
  auditLog,
  enrollment,
  enrollmentCourse,
  internalRulesVersion,
  member,
  person,
  referralSource,
  rulesAcceptance,
  season,
} from "./schema";

/**
 * The internal rules accepted by each payer per season, the « Refuse les
 * photos » flag and the answers to « Comment nous avez-vous connus ? » (#296).
 * Every change is written to the audit log. Always within the `withSchool()`
 * transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
export type Result = { ok: true } | { ok: false; message: string };

const isUuid = (v: string) => z.uuid().safeParse(v).success;
const STUDENT_GONE = "Cet élève n’existe plus.";
const PAYER_GONE = "Ce payeur n’existe plus.";
const SEASON_GONE = "Cette saison n’existe plus.";
const ANSWER_GONE = "Cette réponse n’existe plus.";
/** Enrollments that ask for the rules: the student dances this season (as for the documents, #287). */
const ENROLLED = sql`IN ('active', 'trial')`;

/** The member writing, for the audit log; null if the account is no longer a member. */
async function actorOf(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx.select({ id: member.id }).from(member).where(eq(member.userId, userId));
  return m?.id ?? null;
}

async function seasonExists(tx: Tx, seasonId: string): Promise<boolean> {
  if (!isUuid(seasonId)) return false;
  const [s] = await tx.select({ id: season.id }).from(season).where(eq(season.id, seasonId));
  return s !== undefined;
}

// ---------------------------------------------------------------------------
// The rules of each season (settings, management)
// ---------------------------------------------------------------------------

/** The rules a season holds now: its latest version; null when the school recorded none. */
export async function currentRulesVersion(tx: Tx, seasonId: string): Promise<{ id: string; text: string } | null> {
  if (!isUuid(seasonId)) return null;
  const [v] = await tx
    .select({ id: internalRulesVersion.id, text: internalRulesVersion.text })
    .from(internalRulesVersion)
    .where(eq(internalRulesVersion.seasonId, seasonId))
    .orderBy(desc(internalRulesVersion.createdAt), desc(internalRulesVersion.id))
    .limit(1);
  return v ?? null;
}

export type SeasonRules = {
  seasonId: string;
  seasonLabel: string;
  /** The current text (or version name); null: none recorded. */
  text: string | null;
  /** Day the current text was saved (Paris, `YYYY-MM-DD`). */
  savedOn: string | null;
  /** Versions saved for the season, the current one included. */
  versions: number;
  /** Payers who accepted the season's rules, whatever the version. */
  acceptances: number;
};

/** Every season with its rules, the latest season first. */
export async function seasonsRules(tx: Tx): Promise<SeasonRules[]> {
  const rows = await tx.execute<{
    season_id: string;
    season_label: string;
    text: string | null;
    saved_on: string | null;
    versions: number;
    acceptances: number;
  }>(sql`
    SELECT s.id AS season_id, s.label AS season_label, v.text,
      to_char(v.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS saved_on,
      (SELECT count(*)::int FROM internal_rules_version x WHERE x.season_id = s.id) AS versions,
      (SELECT count(*)::int FROM rules_acceptance a WHERE a.season_id = s.id) AS acceptances
    FROM season s
    LEFT JOIN LATERAL (
      SELECT x.text, x.created_at FROM internal_rules_version x WHERE x.season_id = s.id
      ORDER BY x.created_at DESC, x.id DESC LIMIT 1
    ) v ON true
    ORDER BY s.start_date DESC`);
  return rows.map((r) => ({
    seasonId: r.season_id,
    seasonLabel: r.season_label,
    text: r.text,
    savedOn: r.saved_on,
    versions: r.versions,
    acceptances: r.acceptances,
  }));
}

export const validRulesText = z
  .string({ error: "Saisie invalide." })
  .max(RULES_TEXT_MAX, `Le règlement tient en ${RULES_TEXT_MAX.toLocaleString("fr-FR")} caractères au plus.`);

/**
 * Saves the season's rules: a changed text becomes a new version, the earlier
 * ones stay with the payers who accepted them; the same text saves nothing.
 * Serialised per season (lock on its row), so two saves never race.
 */
export async function saveRulesText(tx: Tx, userId: string, seasonId: string, text: string): Promise<Result> {
  const t = validRulesText.safeParse(text);
  if (!t.success) return { ok: false, message: t.error.issues[0]?.message ?? "Saisie invalide." };
  if (!isUuid(seasonId)) return { ok: false, message: SEASON_GONE };
  const [s] = await tx.select({ id: season.id }).from(season).where(eq(season.id, seasonId)).for("update");
  if (!s) return { ok: false, message: SEASON_GONE };
  const current = await currentRulesVersion(tx, seasonId);
  const next = normalisedRules(t.data);
  if (next === "") return { ok: false, message: "Indiquez le texte du règlement ou le nom de sa version." };
  if (!rulesChanged(current?.text ?? null, next)) return { ok: true };
  const [{ id }] = await tx
    .insert(internalRulesVersion)
    .values({ schoolId: CURRENT_SCHOOL, seasonId, text: next })
    .returning({ id: internalRulesVersion.id });
  // The text is in the version row, kept for good: the log says which version replaced which.
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "internal_rules_version",
    rowId: id,
    action: "insert",
    before: current ? { seasonId, versionId: current.id } : null,
    after: { seasonId, versionId: id, length: next.length },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Acceptance by each payer (records, front desk and management)
// ---------------------------------------------------------------------------

/** Where a payer stands with the season's rules. */
export type PayerRules = {
  payerId: string;
  payerName: string;
  /** First day of the payer's active or trial enrollments of the season; null: none. */
  firstEnrolledOn: string | null;
  acceptedOn: string | null;
  /** The text accepted is no longer the season's current one (rules changed since). */
  olderVersion: boolean;
};

/** The season's rules for these payers, in their order. */
export async function payersRules(tx: Tx, payerIds: readonly string[], seasonId: string): Promise<PayerRules[]> {
  const ids = [...new Set(payerIds)].filter(isUuid);
  if (ids.length === 0 || !isUuid(seasonId)) return [];
  const current = await currentRulesVersion(tx, seasonId);
  const rows = await tx
    .select({
      id: person.id,
      name: person.lastName,
      firstName: person.firstName,
      companyName: person.companyName,
      acceptedOn: rulesAcceptance.acceptedOn,
      versionId: rulesAcceptance.rulesVersionId,
      firstEnrolledOn: sql<string | null>`(
        SELECT min(i.enrolled_on)::text FROM enrollment i
        WHERE i.payer_id = ${person.id} AND i.season_id = ${seasonId} AND i.status ${ENROLLED})`,
    })
    .from(person)
    .leftJoin(rulesAcceptance, and(eq(rulesAcceptance.payerId, person.id), eq(rulesAcceptance.seasonId, seasonId)))
    .where(inArray(person.id, ids));
  return ids.flatMap((id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return [];
    return [
      {
        payerId: r.id,
        payerName: displayedName(r),
        firstEnrolledOn: r.firstEnrolledOn,
        acceptedOn: r.acceptedOn,
        olderVersion: r.acceptedOn !== null && current !== null && r.versionId !== current.id,
      },
    ];
  });
}

/**
 * Payers of the student's enrollments of the season, the ones that ask for the
 * rules (`enrolled`: active or trial) and the others (waitlist), by name.
 */
export async function studentPayers(
  tx: Tx,
  studentId: string,
  seasonId: string,
): Promise<{ payerId: string; enrolled: boolean }[]> {
  if (!isUuid(studentId) || !isUuid(seasonId)) return [];
  return tx
    .select({
      payerId: enrollment.payerId,
      enrolled: sql<boolean>`bool_or(${enrollment.status} ${ENROLLED})`,
    })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .where(
      and(
        eq(enrollmentCourse.studentId, studentId),
        eq(enrollment.seasonId, seasonId),
        sql`${enrollment.status} IN ('active', 'trial', 'waitlist')`,
      ),
    )
    .groupBy(enrollment.payerId)
    .orderBy(asc(enrollment.payerId));
}

const validAcceptedOn = (today: string) =>
  z.iso
    .date("Date invalide.")
    .refine((d) => d <= today, { message: "La date de signature ne peut pas être dans le futur." });

/** The payer's acceptance of the season, locked for the change (a lock on the pair: no row may exist yet). */
async function currentAcceptance(tx: Tx, payerId: string, seasonId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rules_acceptance:${payerId}:${seasonId}`}, 0))`,
  );
  const [a] = await tx
    .select({
      id: rulesAcceptance.id,
      acceptedOn: rulesAcceptance.acceptedOn,
      versionId: rulesAcceptance.rulesVersionId,
    })
    .from(rulesAcceptance)
    .where(and(eq(rulesAcceptance.payerId, payerId), eq(rulesAcceptance.seasonId, seasonId)))
    .for("update");
  return a ?? null;
}

async function payerExists(tx: Tx, payerId: string): Promise<boolean> {
  if (!isUuid(payerId)) return false;
  const [p] = await tx.select({ id: person.id }).from(person).where(eq(person.id, payerId));
  return p !== undefined;
}

/**
 * Records that the payer signed the season's rules on `acceptedOn`, with the
 * season's current version; an acceptance already recorded only gets its date
 * corrected (it keeps the version signed). The audit log keeps every state.
 */
export async function acceptRules(
  tx: Tx,
  userId: string,
  payerId: string,
  seasonId: string,
  acceptedOn: string,
  today: string,
): Promise<Result> {
  const d = validAcceptedOn(today).safeParse(acceptedOn);
  if (!d.success) return { ok: false, message: d.error.issues[0]?.message ?? "Date invalide." };
  if (!(await payerExists(tx, payerId))) return { ok: false, message: PAYER_GONE };
  if (!(await seasonExists(tx, seasonId))) return { ok: false, message: SEASON_GONE };
  const was = await currentAcceptance(tx, payerId, seasonId);
  const logged = (a: { acceptedOn: string; versionId: string | null }) => ({
    payerId,
    seasonId,
    acceptedOn: a.acceptedOn,
    rulesVersionId: a.versionId,
  });
  if (was) {
    if (was.acceptedOn === d.data) return { ok: true };
    await tx.update(rulesAcceptance).set({ acceptedOn: d.data }).where(eq(rulesAcceptance.id, was.id));
    await tx.insert(auditLog).values({
      schoolId: CURRENT_SCHOOL,
      actor: await actorOf(tx, userId),
      targetTable: "rules_acceptance",
      rowId: was.id,
      action: "update",
      before: logged(was),
      after: logged({ acceptedOn: d.data, versionId: was.versionId }),
    });
    return { ok: true };
  }
  const version = await currentRulesVersion(tx, seasonId);
  const [{ id }] = await tx
    .insert(rulesAcceptance)
    .values({
      schoolId: CURRENT_SCHOOL,
      payerId,
      seasonId,
      rulesVersionId: version?.id ?? null,
      acceptedOn: d.data,
    })
    .returning({ id: rulesAcceptance.id });
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "rules_acceptance",
    rowId: id,
    action: "insert",
    before: null,
    after: logged({ acceptedOn: d.data, versionId: version?.id ?? null }),
  });
  return { ok: true };
}

/** Back to « non signé » (ticked by mistake); the audit log keeps what it was. */
export async function removeRulesAcceptance(
  tx: Tx,
  userId: string,
  payerId: string,
  seasonId: string,
): Promise<Result> {
  if (!(await payerExists(tx, payerId))) return { ok: false, message: PAYER_GONE };
  if (!isUuid(seasonId)) return { ok: false, message: SEASON_GONE };
  const was = await currentAcceptance(tx, payerId, seasonId);
  if (!was) return { ok: true };
  await tx.delete(rulesAcceptance).where(eq(rulesAcceptance.id, was.id));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "rules_acceptance",
    rowId: was.id,
    action: "delete",
    before: { payerId, seasonId, acceptedOn: was.acceptedOn, rulesVersionId: was.versionId },
    after: null,
  });
  return { ok: true };
}

/**
 * « Règlement intérieur » among the row's student's (`person`) missing
 * documents, the SQL twin of `rulesMissing` (src/domain/people/internal-rules.ts):
 * a payer of one of their active or trial enrollments of the season has not
 * signed the season's rules.
 */
export function missingRulesSql(seasonId: string | null): SQL<string[]> {
  if (!seasonId) return sql<string[]>`'{}'::text[]`;
  const id = sql`${person}.${sql.identifier("id")}`;
  return sql<string[]>`CASE WHEN EXISTS (
    SELECT 1 FROM enrollment_course ic JOIN enrollment i ON i.id = ic.enrollment_id
    WHERE ic.student_id = ${id} AND i.season_id = ${seasonId} AND i.status IN ('active', 'trial')
      AND NOT EXISTS (SELECT 1 FROM rules_acceptance ra WHERE ra.payer_id = i.payer_id AND ra.season_id = i.season_id)
  ) THEN ARRAY[${RULES_LABEL}::text] ELSE '{}'::text[] END`;
}

// ---------------------------------------------------------------------------
// « Refuse les photos » (student record)
// ---------------------------------------------------------------------------

/** Notes, or withdraws, the family's refusal of photos and videos of the student (#296 Q1). */
export async function setRefusesPhotos(tx: Tx, userId: string, studentId: string, refuses: boolean): Promise<Result> {
  if (!isUuid(studentId)) return { ok: false, message: STUDENT_GONE };
  const [was] = await tx
    .select({ refusesPhotos: person.refusesPhotos })
    .from(person)
    .where(and(eq(person.id, studentId), eq(person.isStudent, true)))
    .for("no key update");
  if (!was) return { ok: false, message: STUDENT_GONE };
  if (was.refusesPhotos === refuses) return { ok: true };
  await tx.update(person).set({ refusesPhotos: refuses }).where(eq(person.id, studentId));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "person",
    rowId: studentId,
    action: "update",
    before: { refusesPhotos: was.refusesPhotos },
    after: { refusesPhotos: refuses },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// « Comment nous avez-vous connus ? »
// ---------------------------------------------------------------------------

export type ReferralSourceRow = { id: string; label: string; students: number };

/** The answers the school offers, in its order, with how many students gave each. */
export async function listReferralSources(tx: Tx): Promise<ReferralSourceRow[]> {
  return tx
    .select({
      id: referralSource.id,
      label: referralSource.label,
      students: sql<number>`(SELECT count(*)::int FROM person p WHERE p.referral_source_id = ${referralSource.id})`,
    })
    .from(referralSource)
    .orderBy(asc(referralSource.position), asc(referralSource.label));
}

/** Answers are changed one at a time per school: the duplicate check sees the others' last state. */
async function lockSources(tx: Tx) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('referral_source:' || ${CURRENT_SCHOOL}::text, 0))`,
  );
}

const cleanLabel = (label: string) => label.trim().replace(/\s+/g, " ");
const validLabel = z.string({ error: "Saisie invalide." });

/** Adds an answer at the end of the list. */
export async function addReferralSource(tx: Tx, userId: string, label: string): Promise<Result> {
  const l = validLabel.safeParse(label);
  if (!l.success) return { ok: false, message: "Saisie invalide." };
  await lockSources(tx);
  const others = await listReferralSources(tx);
  const refusal = referralRefusal(
    l.data,
    others.map((o) => o.label),
  );
  if (refusal) return { ok: false, message: refusal };
  if (others.length >= REFERRAL_SOURCES_MAX)
    return { ok: false, message: `${REFERRAL_SOURCES_MAX} réponses au plus : retirez-en une d’abord.` };
  const clean = cleanLabel(l.data);
  const [{ id }] = await tx
    .insert(referralSource)
    .values({
      schoolId: CURRENT_SCHOOL,
      label: clean,
      position: sql`(SELECT coalesce(max(position), 0) + 1 FROM referral_source)`,
    })
    .returning({ id: referralSource.id });
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "referral_source",
    rowId: id,
    action: "insert",
    before: null,
    after: { label: clean },
  });
  return { ok: true };
}

/** Renames an answer: the students who gave it keep it, under its new words. */
export async function renameReferralSource(tx: Tx, userId: string, id: string, label: string): Promise<Result> {
  const l = validLabel.safeParse(label);
  if (!l.success || !isUuid(id)) return { ok: false, message: ANSWER_GONE };
  await lockSources(tx);
  const all = await listReferralSources(tx);
  const was = all.find((o) => o.id === id);
  if (!was) return { ok: false, message: ANSWER_GONE };
  const refusal = referralRefusal(
    l.data,
    all.filter((o) => o.id !== id).map((o) => o.label),
  );
  if (refusal) return { ok: false, message: refusal };
  const clean = cleanLabel(l.data);
  if (clean === was.label) return { ok: true };
  await tx.update(referralSource).set({ label: clean }).where(eq(referralSource.id, id));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "referral_source",
    rowId: id,
    action: "update",
    before: { label: was.label },
    after: { label: clean },
  });
  return { ok: true };
}

/** Removes an answer no student gave; one given is kept for the statistics (rename it instead). */
export async function removeReferralSource(tx: Tx, userId: string, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: ANSWER_GONE };
  await lockSources(tx);
  const was = (await listReferralSources(tx)).find((o) => o.id === id);
  if (!was) return { ok: true };
  if (was.students > 0)
    return {
      ok: false,
      message: `« ${was.label} » est la réponse de ${was.students} élève${was.students > 1 ? "s" : ""} : elle reste pour les statistiques. Renommez-la plutôt.`,
    };
  await tx.delete(referralSource).where(eq(referralSource.id, id));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "referral_source",
    rowId: id,
    action: "delete",
    before: { label: was.label },
    after: null,
  });
  return { ok: true };
}

/** The student's answer to « Comment nous avez-vous connus ? »; null: none. */
export async function setReferral(tx: Tx, userId: string, studentId: string, sourceId: string | null): Promise<Result> {
  if (!isUuid(studentId)) return { ok: false, message: STUDENT_GONE };
  if (sourceId !== null) {
    if (!isUuid(sourceId)) return { ok: false, message: ANSWER_GONE };
    const [s] = await tx.select({ id: referralSource.id }).from(referralSource).where(eq(referralSource.id, sourceId));
    if (!s) return { ok: false, message: ANSWER_GONE };
  }
  const [was] = await tx
    .select({ sourceId: person.referralSourceId })
    .from(person)
    .where(and(eq(person.id, studentId), eq(person.isStudent, true)))
    .for("no key update");
  if (!was) return { ok: false, message: STUDENT_GONE };
  if (was.sourceId === sourceId) return { ok: true };
  await tx.update(person).set({ referralSourceId: sourceId }).where(eq(person.id, studentId));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "person",
    rowId: studentId,
    action: "update",
    before: { referralSourceId: was.sourceId },
    after: { referralSourceId: sourceId },
  });
  return { ok: true };
}

/**
 * Sets the answer of the students who have none (first enrollment, #296); a
 * student who already answered keeps their answer.
 */
export async function setReferralIfNone(
  tx: Tx,
  userId: string,
  studentIds: readonly string[],
  sourceId: string,
): Promise<Result> {
  for (const studentId of studentIds) {
    const [p] = await tx.select({ sourceId: person.referralSourceId }).from(person).where(eq(person.id, studentId));
    if (p && p.sourceId === null) {
      const r = await setReferral(tx, userId, studentId, sourceId);
      if (!r.ok) return r;
    }
  }
  return { ok: true };
}

/** The student's photos refusal and answer, for their record; null: no such student. */
export async function studentChoices(
  tx: Tx,
  studentId: string,
): Promise<{ refusesPhotos: boolean; referralId: string | null } | null> {
  if (!isUuid(studentId)) return null;
  const [p] = await tx
    .select({ refusesPhotos: person.refusesPhotos, referralId: person.referralSourceId })
    .from(person)
    .where(eq(person.id, studentId));
  return p ?? null;
}

/** Those of these students who already answered « Comment nous avez-vous connus ? ». */
export async function answeredReferral(tx: Tx, studentIds: readonly string[]): Promise<string[]> {
  const ids = studentIds.filter(isUuid);
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: person.id })
    .from(person)
    .where(and(inArray(person.id, ids), sql`${person.referralSourceId} IS NOT NULL`));
  return rows.map((r) => r.id);
}

/**
 * The record's rules lines: the payers of the student's enrollments of the
 * season, and the payer « Facturé à » (who signs at the next enrollment).
 */
export async function studentRulesLines(
  tx: Tx,
  studentId: string,
  billedToId: string | null,
  seasonId: string,
): Promise<(PayerRules & { enrolled: boolean })[]> {
  const payers = await studentPayers(tx, studentId, seasonId);
  const ids = [...payers.map((p) => p.payerId), ...(billedToId ? [billedToId] : [])];
  return (await payersRules(tx, ids, seasonId)).map((r) => ({
    ...r,
    enrolled: payers.some((p) => p.payerId === r.payerId && p.enrolled),
  }));
}

/** One answer and how many students gave it: all of them, and those new this season. */
export type ReferralCount = { label: string; students: number; newThisSeason: number };

/**
 * Answers for the statistics, in the school's order, then « Non renseigné »:
 * every student who gave each, and those whose first enrollment is in
 * `seasonId` (new this season; none without a season).
 */
export async function referralCounts(tx: Tx, seasonId: string | null): Promise<ReferralCount[]> {
  const season = seasonId && isUuid(seasonId) ? seasonId : null;
  const firstSeason = sql`(
    SELECT i.season_id FROM enrollment_course ic JOIN enrollment i ON i.id = ic.enrollment_id
    WHERE ic.student_id = p.id ORDER BY i.enrolled_on, i.created_at LIMIT 1)`;
  const rows = await tx.execute<{ label: string | null; students: number; new_this_season: number }>(sql`
    SELECT r.label, count(p.id)::int AS students,
      ${season ? sql`count(p.id) FILTER (WHERE ${firstSeason} = ${season})::int` : sql`0`} AS new_this_season
    FROM referral_source r LEFT JOIN person p ON p.referral_source_id = r.id AND p.is_student
    GROUP BY r.id, r.label, r.position
    UNION ALL
    SELECT NULL, count(p.id)::int,
      ${season ? sql`count(p.id) FILTER (WHERE ${firstSeason} = ${season})::int` : sql`0`}
    FROM person p WHERE p.is_student AND p.referral_source_id IS NULL`);
  // The union keeps the school's order only if sorted again: by position, then « Non renseigné ».
  const order = await listReferralSources(tx);
  const rank = (label: string | null) => (label === null ? order.length : order.findIndex((o) => o.label === label));
  return [...rows]
    .sort((a, b) => rank(a.label) - rank(b.label))
    .map((r) => ({ label: r.label ?? "Non renseigné", students: r.students, newThisSeason: r.new_this_season }));
}
