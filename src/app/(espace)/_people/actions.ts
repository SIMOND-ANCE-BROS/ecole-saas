"use server";

import { redirect } from "next/navigation";
import { withSchool } from "@/db";
import { createPerson, type Duplicate, updatePerson, searchPeople, validPersonInput } from "@/db/people";
import { errorsOf } from "@/lib/form-errors";
import { requireRole } from "@/lib/session";

export type Refusal = { message: string; errors: Partial<Record<string, string>>; duplicates?: Duplicate[] };

/** New contact (parent, payer, organisation); without `confirmed`, first returns the likely duplicates. */
export async function createContact(entry: unknown, confirmed: boolean): Promise<Refusal> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const p = validPersonInput.safeParse(entry);
  if (!p.success) return { message: "Vérifiez les champs signalés.", errors: errorsOf(p.error.issues) };
  const r = await withSchool(schoolId, (tx) => createPerson(tx, p.data, confirmed));
  if (r.status === "doublons")
    return { message: "Cette personne existe peut-être déjà.", errors: {}, duplicates: r.duplicates };
  redirect(`/contacts/${r.id}?enregistre=cree`);
}

/** Identity and contact details of a student or a contact. */
export async function updateIdentity(id: string, entry: unknown, back: "eleves" | "contacts"): Promise<Refusal> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const p = validPersonInput.safeParse(entry);
  if (!p.success) return { message: "Vérifiez les champs signalés.", errors: errorsOf(p.error.issues) };
  const r = await withSchool(schoolId, (tx) => updatePerson(tx, id, p.data));
  if (!r.ok) return { message: r.message, errors: {} };
  redirect(`/${back}/${id}?enregistre=modifie`);
}

/** Search for an existing person while typing (guardian, payer). */
export async function searchPeopleAction(entry: string) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  if (typeof entry !== "string") return [];
  return withSchool(schoolId, (tx) => searchPeople(tx, entry.slice(0, 100)));
}
