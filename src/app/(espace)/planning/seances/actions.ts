"use server";

import { revalidatePath } from "next/cache";
import { withSchool } from "@/db";
import { currentSeason } from "@/db/schedule";
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
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => saveAttendance(tx, lessonId, attendances as never));
  revalidatePath(`/planning/seances/${lessonId}`);
  return back(r);
}

export async function replace(lessonId: string, instructorId: string): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => changeInstructor(tx, lessonId, instructorId));
  revalidatePath(`/planning/seances/${lessonId}`);
  return back(r);
}

export async function cancel(lessonId: string, annulee: boolean): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => (annulee ? cancelLesson(tx, lessonId) : restoreLesson(tx, lessonId)));
  revalidatePath(`/planning/seances/${lessonId}`);
  return back(r);
}

/** Closures of the current season: management; upcoming lessons follow at once. */
async function withCurrentSeason(action: (seasonId: string) => Parameters<typeof withSchool>[1]): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction");
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, today);
    if (!season) return { ok: false as const, message: "Aucune saison n’est paramétrée." };
    const result = (await action(season.id)(tx)) as { ok: true } | { ok: false; message: string };
    if (result.ok) await syncLessons(tx, season.id, today);
    return result;
  });
  revalidatePath("/planning/fermetures");
  return back(r);
}

export async function close(entry: unknown): Promise<Back> {
  return withCurrentSeason((seasonId) => (tx) => addClosure(tx, seasonId, entry as never));
}

export async function reopen(closureId: string): Promise<Back> {
  return withCurrentSeason(() => (tx) => deleteClosure(tx, closureId));
}

/** Recomputes the upcoming lessons (after an import, or on first use). */
export async function updateLessons(): Promise<Back> {
  return withCurrentSeason(() => async () => ({ ok: true }));
}
