"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSchool } from "@/db";
import { type DocumentInput, receiveToday, removeDocument, saveDocument } from "@/db/student-documents";
import { REQUIRABLE_TYPES, type RequirableType } from "@/domain/people/documents";
import { todayInParis } from "@/domain/people/age";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/**
 * Documents of a student (#287): front desk and management. Typed for the
 * call sites, still parsed: a server action receives whatever the browser sends.
 */

const validId = z.uuid();
const validType = z.enum(REQUIRABLE_TYPES);
const STUDENT_GONE = "Cet élève n’existe plus.";
const UNKNOWN = "Document inconnu.";

/** « Reçu aujourd’hui »: one click, validity from the school's setting. */
export async function receiveDocumentToday(studentId: string, type: RequirableType): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(studentId);
  if (!id.success) return { ok: false, message: STUDENT_GONE };
  const t = validType.safeParse(type);
  if (!t.success) return { ok: false, message: UNKNOWN };
  const r = await withSchool(schoolId, (tx) => receiveToday(tx, userId, id.data, t.data, todayInParis()));
  revalidatePath(`/eleves/${id.data}`);
  return actionResult(r);
}

/** Date received, validity and answer, as corrected on the record. */
export async function editDocument(studentId: string, entry: DocumentInput): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(studentId);
  if (!id.success) return { ok: false, message: STUDENT_GONE };
  const r = await withSchool(schoolId, (tx) => saveDocument(tx, userId, id.data, entry, todayInParis()));
  revalidatePath(`/eleves/${id.data}`);
  return actionResult(r);
}

/** Back to « non reçu »; the audit log keeps what was recorded. */
export async function unreceiveDocument(studentId: string, type: RequirableType): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(studentId);
  if (!id.success) return { ok: false, message: STUDENT_GONE };
  const t = validType.safeParse(type);
  if (!t.success) return { ok: false, message: UNKNOWN };
  const r = await withSchool(schoolId, (tx) => removeDocument(tx, userId, id.data, t.data));
  revalidatePath(`/eleves/${id.data}`);
  return actionResult(r);
}
