import { type SQL, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { pseudonymisationCutoff, unclassifiedKeys } from "../domain/audit/pseudonymise";

/**
 * Pseudonymisation of personal values in the current school's audit log (#184, ADR 0010), run by
 * `npm run audit:pseudonymise` inside `withSchool`. The database does the redaction
 * (`pseudonymise_audit_entries`, migration 0069); this module chooses the entries.
 *
 * END OF THE RELATIONSHIP — PROPOSED, AWAITING THE OWNER (#184, open question). Kept here, in
 * `DUE_ENTRIES`, and nowhere else. With `cutoff` = today − 3 years (`pseudonymisationCutoff`):
 *
 * - A person is still in a relationship with the school when, on or after the cutoff, they are the
 *   payer or a student of an enrollment of a season ending then; the payer or a named student of a
 *   lesson pack bought or used then; the payer or a participant of a workshop sign-up made then or
 *   of a season ending then; the payer of a payment dated then, of an invoice issued then or still
 *   on its way to the invoicing tool (`to_send`, `tool_draft`; a cancelled or rejected one never
 *   issued does not count); the payer of a rules acceptance dated then; or their record was created then.
 * - An entry of an enrollment, lesson pack or workshop sign-up is due when every person it names
 *   (payer, students, participants: from the live rows and from every audit entry of that row) is
 *   no longer in a relationship. An entry naming nobody is left as it is.
 * - An invitation entry is due when the link expired before the cutoff, no invitation entry of the
 *   school to the same address expires on or after it, and no member of the school with that
 *   address is active or was deactivated on or after the cutoff (a member deactivated with no
 *   audit entry saying when counts as still there).
 */

/** Rows per call of `pseudonymise_audit_entries` (its own limit is 500). */
const BATCH = 500;

/**
 * The `expiresAt` of the invitation entry aliased `alias`, as written by `logLinks` (an ISO
 * string); NULL when it is missing or malformed, so one odd entry never fails a school's run
 * (the entry is then never due, and never counts as a recent invitation either, see its caller).
 */
const expiresAt = (alias: SQL) => sql`(CASE
    WHEN COALESCE(${alias}.after, ${alias}.before) ->> 'expiresAt'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$'
    THEN (COALESCE(${alias}.after, ${alias}.before) ->> 'expiresAt')::timestamptz
  END)`;

const DUE_ENTRIES = (cutoff: string, limit: number) => sql`
  WITH cutoff AS (
    SELECT ${cutoff}::date AS day, (${cutoff}::date::timestamp AT TIME ZONE 'Europe/Paris') AS at
  ),
  candidates AS (
    SELECT a.id, a.target_table, a.row_id, a.before, a.after
    FROM audit_log a
    WHERE EXISTS (
      SELECT 1
      FROM audit_personal_keys() k
      CROSS JOIN LATERAL (VALUES (a.before -> k.key), (a.after -> k.key)) v(value)
      WHERE k.target_table = a.target_table
        AND jsonb_typeof(v.value) = 'string'
        AND v.value <> to_jsonb(audit_placeholder())
    )
  ),
  recent_packs AS (
    SELECT lp.id, lp.payer_id
    FROM lesson_pack lp, cutoff
    WHERE lp.purchased_on >= cutoff.day
      OR EXISTS (
        SELECT 1 FROM lesson_pack_usage u JOIN lesson l ON l.id = u.lesson_id
        WHERE u.lesson_pack_id = lp.id AND l.date >= cutoff.day
      )
  ),
  recent_signups AS (
    SELECT w.id, w.payer_id
    FROM workshop_signup w
    JOIN course c ON c.id = w.course_id
    JOIN season s ON s.id = c.season_id, cutoff
    WHERE w.signed_up_on >= cutoff.day OR s.end_date >= cutoff.day
  ),
  in_relationship AS (
    SELECT e.payer_id AS id FROM enrollment e JOIN season s ON s.id = e.season_id, cutoff WHERE s.end_date >= cutoff.day
    UNION SELECT ec.student_id FROM enrollment_course ec
      JOIN enrollment e ON e.id = ec.enrollment_id JOIN season s ON s.id = e.season_id, cutoff
      WHERE s.end_date >= cutoff.day
    UNION SELECT payer_id FROM recent_packs
    UNION SELECT lpp.person_id FROM lesson_pack_person lpp JOIN recent_packs r ON r.id = lpp.lesson_pack_id
    UNION SELECT payer_id FROM recent_signups
    UNION SELECT wp.person_id FROM workshop_signup_person wp JOIN recent_signups r ON r.id = wp.workshop_signup_id
    UNION SELECT p.payer_id FROM payment p, cutoff WHERE p.date >= cutoff.day
    UNION SELECT i.payer_id FROM invoice i, cutoff WHERE i.status IN ('to_send', 'tool_draft') OR i.issued_on >= cutoff.day
    UNION SELECT r.payer_id FROM rules_acceptance r, cutoff WHERE r.accepted_on >= cutoff.day
    UNION SELECT p.id FROM person p, cutoff WHERE p.created_at >= cutoff.at
  ),
  subjects AS (
    SELECT x.target_table, x.row_id, n.value #>> '{}' AS person_id
    FROM audit_log x
    CROSS JOIN LATERAL (VALUES (x.before), (x.after)) side(value)
    CROSS JOIN LATERAL (VALUES
      ('lax $.payerId'::jsonpath), ('lax $.studentIds[*]'), ('lax $.participantIds[*]'), ('lax $.courses[*].studentId')
    ) p(path)
    CROSS JOIN LATERAL jsonb_path_query(side.value, p.path) n(value)
    WHERE side.value IS NOT NULL
      AND (x.target_table, x.row_id) IN (SELECT target_table, row_id FROM candidates)
    UNION SELECT 'enrollment', e.id, e.payer_id::text FROM enrollment e
    UNION SELECT 'enrollment', ec.enrollment_id, ec.student_id::text FROM enrollment_course ec
    UNION SELECT 'lesson_pack', lp.id, lp.payer_id::text FROM lesson_pack lp
    UNION SELECT 'lesson_pack', lpp.lesson_pack_id, lpp.person_id::text FROM lesson_pack_person lpp
    UNION SELECT 'workshop_signup', w.id, w.payer_id::text FROM workshop_signup w
    UNION SELECT 'workshop_signup', wp.workshop_signup_id, wp.person_id::text FROM workshop_signup_person wp
  )
  SELECT c.id
  FROM candidates c, cutoff
  WHERE CASE
    WHEN c.target_table IN ('enrollment', 'lesson_pack', 'workshop_signup') THEN
      EXISTS (SELECT 1 FROM subjects s WHERE s.target_table = c.target_table AND s.row_id = c.row_id)
      AND NOT EXISTS (
        SELECT 1 FROM subjects s JOIN in_relationship r ON r.id::text = s.person_id
        WHERE s.target_table = c.target_table AND s.row_id = c.row_id
      )
    WHEN c.target_table = 'invitation' THEN
      ${expiresAt(sql`c`)} < cutoff.at
      AND NOT EXISTS (
        SELECT 1 FROM audit_log o
        WHERE o.target_table = 'invitation'
          AND lower(COALESCE(o.after, o.before) ->> 'email') = lower(COALESCE(c.after, c.before) ->> 'email')
          AND COALESCE(${expiresAt(sql`o`)}, 'infinity') >= cutoff.at
      )
      AND NOT EXISTS (
        SELECT 1 FROM member m JOIN "user" u ON u.id = m.user_id
        WHERE lower(u.email) = lower(COALESCE(c.after, c.before) ->> 'email')
          AND (
            m.active
            OR EXISTS (
              SELECT 1 FROM audit_log d
              WHERE d.target_table = 'member' AND d.row_id = m.id AND d.after ->> 'active' = 'false' AND d.at >= cutoff.at
            )
            OR NOT EXISTS (
              SELECT 1 FROM audit_log d
              WHERE d.target_table = 'member' AND d.row_id = m.id AND d.after ->> 'active' = 'false'
            )
          )
      )
    ELSE false
  END
  ORDER BY c.id
  LIMIT ${limit}`;

/** Ids of the school's audit entries whose personal values are due for pseudonymisation on `today`. */
export async function dueEntries(tx: Tx, today: string, limit: number = BATCH): Promise<number[]> {
  const rows = await tx.execute<{ id: string | number }>(DUE_ENTRIES(pseudonymisationCutoff(today), limit));
  return rows.map((r) => Number(r.id));
}

/** Pseudonymises the given entries of the current school (at most 500); returns how many changed. */
export async function pseudonymiseEntries(tx: Tx, ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const [{ changed }] = await tx.execute<{ changed: number }>(
    sql`SELECT pseudonymise_audit_entries(${`{${ids.join(",")}}`}::bigint[]) AS changed`,
  );
  return Number(changed);
}

/** Keys of the school's audit log that no list classifies (`unclassifiedKeys`), for the run's report. */
export async function unclassifiedAuditKeys(tx: Tx): Promise<string[]> {
  const rows = await tx.execute<{ targetTable: string; key: string }>(sql`
    SELECT DISTINCT a.target_table AS "targetTable", k.key
    FROM audit_log a
    CROSS JOIN LATERAL (VALUES (a.before), (a.after)) side(value)
    CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(side.value) = 'object' THEN side.value END) k(key)`);
  return unclassifiedKeys(rows);
}

export type PseudonymisationRun = { pseudonymised: number; unclassified: string[] };

/** Runs `fn` in its own transaction of the school (`withSchool(id, fn)`). */
export type SchoolRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * Pseudonymises every due entry of a school, one transaction per batch: a batch failing (a timeout)
 * keeps the batches already done, and the next run goes on from there.
 */
export async function pseudonymiseDue(run: SchoolRunner, today: string): Promise<PseudonymisationRun> {
  let pseudonymised = 0;
  for (;;) {
    const batch = await run(async (tx) => {
      const ids = await dueEntries(tx, today);
      return { chosen: ids.length, changed: await pseudonymiseEntries(tx, ids) };
    });
    pseudonymised += batch.changed;
    // Done; or entries chosen but left unchanged, which would be chosen again: stop rather than loop.
    if (batch.chosen === 0 || batch.changed < batch.chosen) break;
  }
  return { pseudonymised, unclassified: await run(unclassifiedAuditKeys) };
}
