import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_INSTALLMENT_PLANS,
  type InstallmentPlanSetting,
  noDueDayLeft,
  planSettingRefusal,
  planStart,
  plansThatFit,
  sortedCounts,
} from "../domain/invoicing/plans";
import type { Tx } from "./index";
import { auditLog, installmentPlanSetting, member } from "./schema";

/**
 * The school's installment plans (#176), a management setting. Every change is written to the
 * audit log. Always within the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** What the school set, or `DEFAULT_INSTALLMENT_PLANS` when it set nothing. Read without a lock. */
export async function readInstallmentPlans(tx: Tx): Promise<InstallmentPlanSetting> {
  const [row] = await tx
    .select({
      counts: installmentPlanSetting.counts,
      dueDay: installmentPlanSetting.dueDay,
      roundingUnitCents: installmentPlanSetting.roundingUnitCents,
    })
    .from(installmentPlanSetting);
  return row ? { ...row, counts: sortedCounts(row.counts) } : DEFAULT_INSTALLMENT_PLANS;
}

const integer = z.number({ error: "Saisie invalide." }).int("Saisie invalide.");

/** A setting as the form sends it: the counts sorted and each once before the checks. */
export const validInstallmentPlans = z
  .object({
    counts: z.array(integer, { error: "Saisie invalide." }).transform(sortedCounts),
    dueDay: integer,
    roundingUnitCents: integer,
  })
  .superRefine((s, ctx) => {
    const refusal = planSettingRefusal(s);
    if (refusal) ctx.addIssue({ code: "custom", message: refusal });
  });

export type Result = { ok: true } | { ok: false; message: string };

/** Saves the school's plans; a change is written to the audit log, an unchanged save writes nothing. */
export async function saveInstallmentPlans(
  tx: Tx,
  userId: string,
  entry: z.input<typeof validInstallmentPlans>,
): Promise<Result> {
  const r = validInstallmentPlans.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Saisie invalide." };
  const next = r.data;
  // Two saves of the school wait for each other: the second compares with what the first saved.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('installment_plan_setting'), hashtext(${CURRENT_SCHOOL}::text))`,
  );
  const before = await readInstallmentPlans(tx);
  if (
    before.dueDay === next.dueDay &&
    before.roundingUnitCents === next.roundingUnitCents &&
    before.counts.join() === next.counts.join()
  )
    return { ok: true };
  await tx
    .insert(installmentPlanSetting)
    .values({
      schoolId: CURRENT_SCHOOL,
      counts: next.counts,
      dueDay: next.dueDay,
      roundingUnitCents: next.roundingUnitCents,
    })
    .onConflictDoUpdate({
      target: installmentPlanSetting.schoolId,
      set: {
        counts: next.counts,
        dueDay: next.dueDay,
        roundingUnitCents: next.roundingUnitCents,
        updatedAt: sql`now()`,
      },
    });
  const [m] = await tx.select({ id: member.id }).from(member).where(eq(member.userId, userId));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: m?.id ?? null,
    targetTable: "installment_plan_setting",
    rowId: CURRENT_SCHOOL,
    action: "update",
    before: { counts: [...before.counts], due_day: before.dueDay, rounding_unit_cents: before.roundingUnitCents },
    after: { counts: next.counts, due_day: next.dueDay, rounding_unit_cents: next.roundingUnitCents },
  });
  return { ok: true };
}

/** The plans the record offers for a season (#176): the ones that fit, and the ones no longer fitting. */
export type OfferedPlans = {
  counts: number[];
  tooLong: number[];
  dueDay: number;
  /** The first installment's date (#436): in June, the due day of the season's first month. */
  firstDue: string;
  seasonEnd: string;
  /** No due day left in the season (#380): one installment, dated the day it is drafted. */
  noneLeft: boolean;
};

/** What « Préparer les factures » offers for `season` on `today` (`plansThatFit`). */
export async function offeredPlans(
  tx: Tx,
  season: { startDate: string; endDate: string },
  today: string,
): Promise<OfferedPlans> {
  const setting = await readInstallmentPlans(tx);
  const window = { season, today };
  const counts = plansThatFit(setting, window);
  return {
    counts,
    tooLong: setting.counts.filter((c) => !counts.includes(c)),
    dueDay: setting.dueDay,
    firstDue: planStart(setting, window),
    seasonEnd: season.endDate,
    noneLeft: noDueDayLeft(setting, window),
  };
}
