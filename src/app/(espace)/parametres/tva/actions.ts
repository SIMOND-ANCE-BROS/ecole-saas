"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSchool, type Tx } from "@/db";
import {
  createTreatment,
  deleteTreatment,
  type TreatmentInput,
  updateTreatment,
  validTreatmentInput,
} from "@/db/vat-treatments";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

const GONE = "Ce traitement de TVA n’existe plus.";

/** The first French message of a refused input, or null. */
function refusal(entry: unknown): string | null {
  const r = validTreatmentInput.safeParse(entry);
  return r.success ? null : (r.error.issues[0]?.message ?? "Saisie invalide.");
}
const badId = (id: unknown) => !z.uuid().safeParse(id).success;

/**
 * VAT treatments (#301): management only, checked before anything else; a refused
 * input never reaches the database (which parses it again with the same messages).
 */
async function act(
  refused: () => string | null,
  write: (tx: Tx, userId: string) => Promise<{ ok: true } | { ok: false; message: string }>,
): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const message = refused();
  if (message) return { ok: false, message };
  const r = await withSchool(schoolId, (tx) => write(tx, userId));
  revalidatePath("/parametres/tva");
  revalidatePath("/parametres/entreprises");
  return actionResult(r);
}

export async function newTreatment(entry: TreatmentInput) {
  return act(
    () => refusal(entry),
    (tx, userId) => createTreatment(tx, userId, entry),
  );
}

export async function changeTreatment(id: string, entry: TreatmentInput) {
  return act(
    () => refusal(entry) ?? (badId(id) ? GONE : null),
    (tx, userId) => updateTreatment(tx, userId, id, entry),
  );
}

export async function removeTreatment(id: string) {
  return act(
    () => (badId(id) ? GONE : null),
    (tx, userId) => deleteTreatment(tx, userId, id),
  );
}
