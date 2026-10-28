"use server";

import { revalidatePath } from "next/cache";
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
} from "@/db/lessons";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";

type Back = { message: string | null };
const back = (r: { ok: true } | { ok: false; message: string }): Back => ({ message: r.ok ? null : r.message });

/** Attendance of a lesson: front desk and management. */
export async function doAttendance(lessonId: string, attendances: unknown): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const r = await withSchool(schoolId, (tx) => saveAttendance(tx, lessonId, attendances as never));
  revalidatePath(`/planning/seances/${lessonId}`);
  return back(r);
}

export async function replace(lessonId: string, instructorId: string): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const r = await withSchool(schoolId, (tx) => changeInstructor(tx, lessonId, instructorId));
  revalidatePath(`/planning/seances/${lessonId}`);
  return back(r);
}

export async function cancel(lessonId: string, cancelled: boolean): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const r = await withSchool(schoolId, (tx) => (cancelled ? cancelLesson(tx, lessonId) : restoreLesson(tx, lessonId)));
  revalidatePath(`/planning/seances/${lessonId}`);
  return back(r);
}

/**
 * Closures of the season shown (`?saison=`, #189; the current one when none is
 * given): management; upcoming lessons follow at once.
 */
async function withSeasonOf(
  seasonId: unknown,
  action: (seasonId: string) => Parameters<typeof withSchool>[1],
): Promise<Back & { removed?: number }> {
  const { schoolId: schoolId } = await requireRole("director");
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
  // How many lessons the closure took off the planning (#200): 0 says it covers nothing.
  return { ...back(r), removed: r.ok ? r.removed : undefined };
}

export async function close(entry: unknown, seasonId?: unknown): Promise<Back & { removed?: number }> {
  return withSeasonOf(seasonId, (id) => (tx) => addClosure(tx, id, entry as never));
}

/** Removes a closure: the lessons of ITS season come back, whatever season is shown. */
export async function reopen(closureId: string): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("director");
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx) => {
    const result = await deleteClosure(tx, closureId);
    if (result.ok) await syncLessons(tx, result.seasonId, today);
    return result;
  });
  revalidatePath("/planning/fermetures");
  return back(r);
}

/** Recomputes the upcoming lessons (after an import, or on first use). */
export async function updateLessons(seasonId?: unknown): Promise<Back> {
  return withSeasonOf(seasonId, () => async () => ({ ok: true }));
}
