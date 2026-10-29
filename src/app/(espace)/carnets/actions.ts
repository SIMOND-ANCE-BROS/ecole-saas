"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { type SaleInput, sellLessonPack } from "@/db/lesson-packs";
import { once, storedLessonPack } from "@/db/submissions";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";

/** Return to the record the sale was opened from: only a student or contact record. */
const safeReturnPath = (r: unknown) =>
  typeof r === "string" && /^\/(eleves|contacts)\/[0-9a-f-]{36}$/.test(r) ? r : null;

/**
 * Sells a lesson pack to a payer (#286, front desk and management), then returns
 * to the record. `key` is generated once by the form: a retry after a lost
 * response sells nothing twice (#260).
 */
export async function sellPack(
  payerId: string,
  entry: SaleInput,
  back: unknown,
  key: string,
): Promise<{ message: string }> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  if (!z.uuid().safeParse(key).success || !z.uuid().safeParse(payerId).success) return { message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) =>
    once(tx, "lesson_pack", key, { payerId, entry }, storedLessonPack, () =>
      sellLessonPack(tx, userId, payerId, entry, todayInParis()),
    ),
  );
  if (!r.ok) return { message: r.message };
  const path = safeReturnPath(back) ?? `/personnes/${payerId}`;
  revalidatePath(path);
  redirect(`${path}?carnet=vendu`);
}
