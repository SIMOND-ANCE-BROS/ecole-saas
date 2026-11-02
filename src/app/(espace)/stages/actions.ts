"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { once, storedWorkshopSignup } from "@/db/submissions";
import { cancelWorkshopSignup, type SignupInput, signUpForWorkshop } from "@/db/workshops";
import { todayInParis } from "@/domain/people/age";
import type { ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/** Return to the record the sign-up was opened from: only a student or contact record. */
const safeReturnPath = (r: unknown) =>
  typeof r === "string" && /^\/(eleves|contacts)\/[0-9a-f-]{36}$/.test(r) ? r : null;

/**
 * Signs students of a payer up for a workshop (#297, front desk and management), then returns
 * to the record. `key` is generated once by the form: a retry after a lost response signs
 * nobody up twice (#260).
 */
export async function signUp(
  payerId: string,
  entry: SignupInput,
  back: unknown,
  key: string,
): Promise<{ message: string }> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  if (!z.uuid().safeParse(key).success || !z.uuid().safeParse(payerId).success) return { message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) =>
    once(tx, "workshop_signup", key, { payerId, entry }, storedWorkshopSignup, () =>
      signUpForWorkshop(tx, userId, payerId, entry, todayInParis()),
    ),
  );
  if (!r.ok) return { message: r.message };
  const path = safeReturnPath(back) ?? `/personnes/${payerId}`;
  revalidatePath(path);
  redirect(`${path}?stage=inscrit`);
}

/** Cancels a workshop sign-up entered by mistake (front desk and management). */
export async function cancelSignup(signupId: string): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  if (!z.uuid().safeParse(signupId).success) return { ok: false, message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) => cancelWorkshopSignup(tx, userId, signupId));
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
