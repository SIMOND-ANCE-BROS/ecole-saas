"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withSchool } from "@/db";
import {
  addGuardian,
  changeNotify,
  createStudent,
  setBilling,
  billTo,
  type DuplicateWithRole,
  markStudent,
  CreationRefusal,
  validStudentInput,
} from "@/db/students";
import { deleteRelationship } from "@/db/people";
import { errorsOf } from "@/lib/form-errors";
import { requireRole } from "@/lib/session";

export type StudentRefusal = {
  message: string;
  errors: Partial<Record<string, string>>;
  duplicates?: DuplicateWithRole[];
};
type Back = { message: string | null };
const back = (r: { ok: true } | { ok: false; message: string }): Back => ({ message: r.ok ? null : r.message });

/** Student, guardian and payer in a single entry; without `confirmed`, first returns the likely duplicates. */
export async function createStudentFromGuide(entry: unknown, confirmed: boolean): Promise<StudentRefusal> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const s = validStudentInput.safeParse(entry);
  if (!s.success) return { message: "Vérifiez les champs signalés.", errors: errorsOf(s.error.issues) };
  let r;
  try {
    r = await withSchool(schoolId, (tx) => createStudent(tx, s.data, confirmed));
  } catch (e) {
    if (e instanceof CreationRefusal) return { message: e.message, errors: {} };
    throw e;
  }
  if (r.status === "doublons")
    return { message: "Certaines personnes existent peut-être déjà.", errors: {}, duplicates: r.duplicates };
  redirect(`/eleves/${r.id}?enregistre=cree`);
}

export async function invoice(
  studentId: string,
  target: { type: "eleve" } | { type: "personne"; id: string },
): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => setBilling(tx, studentId, target));
  revalidatePath(`/eleves/${studentId}`);
  return back(r);
}

/** Invoice a known person or one just created (organisation, other relative). */
export async function billNewPerson(studentId: string, payer: unknown): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => billTo(tx, studentId, payer as never));
  revalidatePath(`/eleves/${studentId}`);
  return back(r);
}

export async function addGuardianAction(studentId: string, guardian: unknown, toNotify: boolean): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => addGuardian(tx, studentId, guardian as never, toNotify));
  revalidatePath(`/eleves/${studentId}`);
  return back(r);
}

export async function notify(studentId: string, relationshipId: string, toNotify: boolean): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => changeNotify(tx, relationshipId, toNotify));
  revalidatePath(`/eleves/${studentId}`);
  return back(r);
}

export async function removeRelative(studentId: string, relationshipId: string): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => deleteRelationship(tx, relationshipId));
  revalidatePath(`/eleves/${studentId}`);
  return back(r);
}

/** A contact (a parent who also dances) becomes a student. */
export async function becomeStudent(id: string): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => markStudent(tx, id, true));
  if (!r.ok) return back(r);
  redirect(`/eleves/${id}`);
}
