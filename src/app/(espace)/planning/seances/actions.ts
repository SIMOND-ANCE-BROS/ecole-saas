"use server";

import { revalidatePath } from "next/cache";
import { withSchool } from "@/db";
import { currentSeason } from "@/db/planning";
import {
  addClosure,
  cancelLesson,
  changeInstructor,
  saveAttendance,
  restoreLesson,
  deleteClosure,
  syncLessons,
} from "@/db/seances";
import { todayInParis } from "@/domaine/personnes/age";
import { requireRole } from "@/lib/session";

type Back = { message: string | null };
const back = (r: { ok: true } | { ok: false; message: string }): Back => ({ message: r.ok ? null : r.message });

/** Appel d'une séance : accueil et direction. */
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

/** Fermetures de la saison courante : direction ; les séances à venir suivent aussitôt. */
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

export async function close(saisie: unknown): Promise<Back> {
  return withCurrentSeason((seasonId) => (tx) => addClosure(tx, seasonId, saisie as never));
}

export async function reopen(closureId: string): Promise<Back> {
  return withCurrentSeason(() => (tx) => deleteClosure(tx, closureId));
}

/** Recalcule les séances à venir (après un import, ou au premier usage). */
export async function updateLessons(): Promise<Back> {
  return withCurrentSeason(() => async () => ({ ok: true }));
}
