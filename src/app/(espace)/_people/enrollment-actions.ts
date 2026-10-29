"use server";

import { z } from "zod";
import { withSchool } from "@/db";
import {
  cancelEnrollment,
  confirmEnrollment,
  type ConfirmationPreview,
  confirmationPreview,
  dropEnrollment,
  type ExistingImpact,
  leavingImpacts,
} from "@/db/enrollments";
import type { ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/**
 * Status changes of a saved enrollment (#284), from the student and payer records:
 * confirm a trial or waitlist enrollment, record a drop-out, cancel a mistake.
 * Front desk and management. Each change is checked again on the server
 * (`src/domain/enrollment/lifecycle.ts`) and written to the audit log.
 */

const INVALID = "Saisie invalide.";
const id = z.uuid();
const dropDate = z.iso.date();
const cents = z.number().int().nonnegative();

/** Price of the enrollment if confirmed now, and what it changes for the payer's other enrollments. */
export async function confirmationPreviewAction(enrollmentId: string): Promise<ConfirmationPreview> {
  const { schoolId } = await requireRole("director", "front_desk");
  if (!id.safeParse(enrollmentId).success) return { status: "invalid", message: INVALID };
  return withSchool(schoolId, (tx) => confirmationPreview(tx, enrollmentId));
}

/** Confirms a trial or waitlist enrollment at the price the front desk saw (`expectedNetCents`). */
export async function confirmAction(enrollmentId: string, expectedNetCents: number): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  if (!id.safeParse(enrollmentId).success || !cents.safeParse(expectedNetCents).success)
    return { ok: false, message: INVALID };
  const r = await withSchool(schoolId, (tx) => confirmEnrollment(tx, userId, enrollmentId, expectedNetCents));
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}

/** What a drop-out or a cancellation would change for the payer's other enrollments (told, never applied). */
export async function leavingImpactsAction(enrollmentId: string): Promise<ExistingImpact[]> {
  const { schoolId } = await requireRole("director", "front_desk");
  if (!id.safeParse(enrollmentId).success) return [];
  return withSchool(schoolId, (tx) => leavingImpacts(tx, enrollmentId));
}

/** Records a drop-out on `droppedOn` (`YYYY-MM-DD`). */
export async function dropAction(enrollmentId: string, droppedOn: string): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  if (!id.safeParse(enrollmentId).success) return { ok: false, message: INVALID };
  if (!dropDate.safeParse(droppedOn).success) return { ok: false, message: "Indiquez la date de l’abandon." };
  const r = await withSchool(schoolId, (tx) => dropEnrollment(tx, userId, enrollmentId, droppedOn));
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}

/** Cancels an enrollment entered by mistake (never one already invoiced). */
export async function cancelAction(enrollmentId: string): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  if (!id.safeParse(enrollmentId).success) return { ok: false, message: INVALID };
  const r = await withSchool(schoolId, (tx) => cancelEnrollment(tx, userId, enrollmentId));
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
