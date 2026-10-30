import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  DESK_HINT_MAX,
  effectiveMethodSettings,
  type MethodSetting,
  PAYMENT_METHOD_VALUES,
  settingsRefusal,
} from "../domain/payments/methods";
import type { Tx } from "./index";
import { auditLog, member, paymentMethodSetting } from "./schema";

/**
 * Payment methods the school accepts (#293), a management setting. Every change is
 * written to the audit log. Always within the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
export type Result = { ok: true } | { ok: false; message: string };

/** Every method with what the school set for it, or the default, in the screens' order. */
export async function readMethodSettings(tx: Tx): Promise<MethodSetting[]> {
  const saved = await tx
    .select({
      method: paymentMethodSetting.method,
      accepted: paymentMethodSetting.accepted,
      deskHint: paymentMethodSetting.deskHint,
    })
    .from(paymentMethodSetting);
  return effectiveMethodSettings(saved);
}

const methodFields = z.object({
  method: z.enum(PAYMENT_METHOD_VALUES, { error: "Moyen de paiement inconnu." }),
  accepted: z.boolean({ error: "Saisie invalide." }),
  deskHint: z
    .string({ error: "Saisie invalide." })
    .trim()
    .max(DESK_HINT_MAX, `Consigne : ${DESK_HINT_MAX} caractères au plus.`)
    .nullable()
    .transform((v) => v || null),
});

/** Every method once, at least one accepted. */
export const validMethodSettings = z.array(methodFields, { error: "Saisie invalide." }).superRefine((rs, ctx) => {
  const refusal = settingsRefusal(rs);
  if (refusal) ctx.addIssue({ code: "custom", message: refusal });
});

/** Saves the methods the school accepts; each method that changes is written to the audit log. */
export async function saveMethodSettings(
  tx: Tx,
  userId: string,
  entry: z.input<typeof validMethodSettings>,
): Promise<Result> {
  const r = validMethodSettings.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Saisie invalide." };
  // Two saves of the school wait for each other (lock released at commit): the second one compares
  // with what the first saved and writes every difference, so the result is always a whole checked
  // list, never one save's « décoché » merged with the other's (none accepted).
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('payment_method_setting'), hashtext(${CURRENT_SCHOOL}::text))`,
  );
  const before = await readMethodSettings(tx);
  const [m] = await tx.select({ id: member.id }).from(member).where(eq(member.userId, userId));
  const actor = m?.id ?? null;
  for (const next of r.data) {
    const was = before.find((b) => b.method === next.method);
    if (was && was.accepted === next.accepted && was.deskHint === next.deskHint) continue;
    await tx
      .insert(paymentMethodSetting)
      .values({ schoolId: CURRENT_SCHOOL, method: next.method, accepted: next.accepted, deskHint: next.deskHint })
      .onConflictDoUpdate({
        target: [paymentMethodSetting.schoolId, paymentMethodSetting.method],
        set: { accepted: next.accepted, deskHint: next.deskHint, updatedAt: sql`now()` },
      });
    // The table is keyed by school and method: the row is the school's, its method is in the entry.
    await tx.insert(auditLog).values({
      schoolId: CURRENT_SCHOOL,
      actor,
      targetTable: "payment_method_setting",
      rowId: CURRENT_SCHOOL,
      action: "update",
      before: was ?? null,
      after: next,
    });
  }
  return { ok: true };
}
