"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSchool } from "@/db";
import { currentSeason, seasonById } from "@/db/schedule";
import {
  addClosure,
  cancelLesson,
  changeInstructor,
  saveAttendance,
  restoreLesson,
  deleteClosure,
  syncLessons,
  validAttendance,
  validClosureInput,
} from "@/db/lessons";
import { todayInParis } from "@/domain/people/age";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

// Typed for the call sites; still parsed, since a server action receives whatever the browser sends.
const validId = z.uuid();
const NO_LESSON = "Cette séance n’existe plus.";

/** Attendance of a lesson: front desk and management. */
export async function doAttendance(
  lessonId: string,
  attendances: z.input<typeof validAttendance>,
): Promise<ActionResult> {
  const { schoolId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(lessonId);
  if (!id.success) return { ok: false, message: NO_LESSON };
  const a = validAttendance.safeParse(attendances);
  if (!a.success) return { ok: false, message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) => saveAttendance(tx, id.data, a.data));
  revalidatePath(`/planning/seances/${id.data}`);
  return actionResult(r);
}

export async function replace(lessonId: string, instructorId: string): Promise<ActionResult> {
  const { schoolId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(lessonId);
  if (!id.success) return { ok: false, message: NO_LESSON };
  const by = validId.safeParse(instructorId);
  if (!by.success) return { ok: false, message: "Intervenant introuvable ou inactif." };
  const r = await withSchool(schoolId, (tx) => changeInstructor(tx, id.data, by.data));
  revalidatePath(`/planning/seances/${id.data}`);
  return actionResult(r);
}

export async function cancel(lessonId: string, cancelled: boolean): Promise<ActionResult> {
  const { schoolId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(lessonId);
  const c = z.boolean().safeParse(cancelled);
  if (!id.success || !c.success) return { ok: false, message: NO_LESSON };
  const r = await withSchool(schoolId, (tx) => (c.data ? cancelLesson(tx, id.data) : restoreLesson(tx, id.data)));
  revalidatePath(`/planning/seances/${id.data}`);
  return actionResult(r);
}

/**
 * Closures of the season shown (`?saison=`, #189; the current one when none is
 * given): management; upcoming lessons follow at once. `removed`: how many
 * lessons left the planning (#200), 0 says the closure covers nothing.
 */
async function withSeasonOf(
  schoolId: string,
  seasonId: unknown,
  action: (seasonId: string) => Parameters<typeof withSchool>[1],
): Promise<ActionResult<{ removed: number }>> {
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx) => {
    const season = seasonId ? await seasonById(tx, seasonId) : await currentSeason(tx, today);
    if (!season)
      return {
        ok: false as const,
        message: seasonId ? "Cette saison n’existe plus." : "Aucune saison n’est paramétrée.",
      };
    const result = (await action(season.id)(tx)) as { ok: true } | { ok: false; message: string };
    if (!result.ok) return result;
    const { removed } = await syncLessons(tx, season.id, today);
    return { ok: true as const, removed };
  });
  revalidatePath("/planning/fermetures");
  return r.ok ? { ok: true, removed: r.removed } : { ok: false, message: r.message };
}

export async function close(
  entry: z.input<typeof validClosureInput>,
  seasonId?: string,
): Promise<ActionResult<{ removed: number }>> {
  const { schoolId } = await requireRole("director");
  const e = validClosureInput.safeParse(entry);
  // The same French message as the database layer gives for that field.
  if (!e.success) return { ok: false, message: e.error.issues[0]?.message ?? "Saisie invalide." };
  return withSeasonOf(schoolId, seasonId, (id) => (tx) => addClosure(tx, id, e.data));
}

/** Removes a closure: the lessons of ITS season come back, whatever season is shown. */
export async function reopen(closureId: string): Promise<ActionResult> {
  const { schoolId } = await requireRole("director");
  const id = validId.safeParse(closureId);
  if (!id.success) return { ok: false, message: "Cette fermeture n’existe plus." };
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx) => {
    const result = await deleteClosure(tx, id.data);
    if (result.ok) await syncLessons(tx, result.seasonId, today);
    return result;
  });
  revalidatePath("/planning/fermetures");
  return actionResult(r);
}

/** Recomputes the upcoming lessons (after an import, or on first use). */
export async function updateLessons(seasonId?: string): Promise<ActionResult> {
  const { schoolId } = await requireRole("director");
  const r = await withSeasonOf(schoolId, seasonId, () => async () => ({ ok: true }));
  return actionResult(r);
}
