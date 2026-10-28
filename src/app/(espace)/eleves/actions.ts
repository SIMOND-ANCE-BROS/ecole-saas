"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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
  otherValidPerson,
  validStudentInput,
  type StudentInput,
} from "@/db/students";
import { deleteRelationship } from "@/db/people";
import { errorsOf, type FieldErrors } from "@/lib/form-errors";
import { requireRole } from "@/lib/session";

export type StudentRefusal = {
  message: string;
  errors: FieldErrors<StudentInput>;
  duplicates?: DuplicateWithRole[];
};
type Back = { message: string | null };
const back = (r: { ok: true } | { ok: false; message: string }): Back => ({ message: r.ok ? null : r.message });

/** Student, guardian and payer in a single entry; without `confirmed`, first returns the likely duplicates. */
export async function createStudentFromGuide(entry: unknown, confirmed: boolean): Promise<StudentRefusal> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const s = validStudentInput.safeParse(entry);
  if (!s.success) return { message: "Vérifiez les champs signalés.", errors: errorsOf(s.error) };
  let r;
  try {
    r = await withSchool(schoolId, (tx) => createStudent(tx, s.data, confirmed));
  } catch (e) {
    if (e instanceof CreationRefusal) return { message: e.message, errors: {} };
    throw e;
  }
  if (r.status === "duplicates")
    return { message: "Certaines personnes existent peut-être déjà.", errors: {}, duplicates: r.duplicates };
  redirect(`/eleves/${r.id}?enregistre=cree`);
}

export type ActionResult = { ok: true } | { ok: false; message: string };
const result = (r: { ok: true } | { ok: false; message: string }): ActionResult =>
  r.ok ? { ok: true } : { ok: false, message: r.message };

const validBillingTarget = z.discriminatedUnion("type", [
  z.object({ type: z.literal("self") }),
  z.object({ type: z.literal("person"), id: z.uuid() }),
]);

/** « Facturé à »: the student themselves or a person already linked to them. */
// Typed for the call sites; still parsed, since a server action receives whatever the browser sends.
export async function invoice(studentId: string, target: z.input<typeof validBillingTarget>): Promise<ActionResult> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const id = z.uuid().safeParse(studentId);
  const t = validBillingTarget.safeParse(target);
  if (!id.success || !t.success) return { ok: false, message: "Choix de facturation invalide." };
  const r = await withSchool(schoolId, (tx) => setBilling(tx, id.data, t.data));
  revalidatePath(`/eleves/${id.data}`);
  return result(r);
}

/** Invoice a known person or one just created (organisation, other relative). */
export async function billNewPerson(studentId: string, payer: z.input<typeof otherValidPerson>): Promise<ActionResult> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const id = z.uuid().safeParse(studentId);
  if (!id.success) return { ok: false, message: "Choix de facturation invalide." };
  const p = otherValidPerson.safeParse(payer);
  if (!p.success) return { ok: false, message: "Vérifiez les informations du payeur." };
  const r = await withSchool(schoolId, (tx) => billTo(tx, id.data, p.data));
  revalidatePath(`/eleves/${id.data}`);
  return result(r);
}

export async function addGuardianAction(studentId: string, guardian: unknown, toNotify: boolean): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const r = await withSchool(schoolId, (tx) => addGuardian(tx, studentId, guardian as never, toNotify));
  revalidatePath(`/eleves/${studentId}`);
  return back(r);
}

export async function notify(studentId: string, relationshipId: string, toNotify: boolean): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const r = await withSchool(schoolId, (tx) => changeNotify(tx, relationshipId, toNotify));
  revalidatePath(`/eleves/${studentId}`);
  return back(r);
}

export async function removeRelative(studentId: string, relationshipId: string): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const r = await withSchool(schoolId, (tx) => deleteRelationship(tx, relationshipId));
  revalidatePath(`/eleves/${studentId}`);
  return back(r);
}

/** A contact (a parent who also dances) becomes a student. */
export async function becomeStudent(id: string): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const r = await withSchool(schoolId, (tx) => markStudent(tx, id, true));
  if (!r.ok) return back(r);
  redirect(`/eleves/${id}`);
}
