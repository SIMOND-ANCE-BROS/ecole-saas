"use server";

import { redirect } from "next/navigation";
import { withSchool } from "@/db";
import {
  createPerson,
  type Duplicate,
  updatePerson,
  searchPeople,
  validPersonInput,
  type PersonInput,
} from "@/db/people";
import { GUARDIAN_PERSON_TYPES } from "@/domain/people/guardian";
import { errorsOf, type FieldErrors } from "@/lib/form-errors";
import { requireRole } from "@/lib/session";

export type Refusal = { message: string; errors: FieldErrors<PersonInput>; duplicates?: Duplicate[] };

/** New contact (parent, payer, organisation); without `confirmed`, first returns the likely duplicates. */
export async function createContact(entry: unknown, confirmed: boolean): Promise<Refusal> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const p = validPersonInput.safeParse(entry);
  if (!p.success) return { message: "Vérifiez les champs signalés.", errors: errorsOf(p.error) };
  const r = await withSchool(schoolId, (tx) => createPerson(tx, p.data, confirmed));
  if (r.status === "duplicates")
    return { message: "Cette personne existe peut-être déjà.", errors: {}, duplicates: r.duplicates };
  redirect(`/contacts/${r.id}?enregistre=cree`);
}

/** Identity and contact details of a student or a contact. */
export async function updateIdentity(id: string, entry: unknown, back: "eleves" | "contacts"): Promise<Refusal> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const p = validPersonInput.safeParse(entry);
  if (!p.success) return { message: "Vérifiez les champs signalés.", errors: errorsOf(p.error) };
  const r = await withSchool(schoolId, (tx) => updatePerson(tx, id, p.data));
  if (!r.ok) return { message: r.message, errors: {} };
  redirect(`/${back}/${id}?enregistre=modifie`);
}

/**
 * Search for an existing person while typing (guardian, payer). `guardian`:
 * only the people who can be a legal guardian are offered (#216).
 */
export async function searchPeopleAction(entry: string, guardian = false) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  if (typeof entry !== "string") return [];
  const types = guardian === true ? GUARDIAN_PERSON_TYPES : undefined;
  return withSchool(schoolId, (tx) => searchPeople(tx, entry.slice(0, 100), types));
}
