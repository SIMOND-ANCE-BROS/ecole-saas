"use server";

import { revalidatePath } from "next/cache";
import { withSchool } from "@/db";
import { logCourseRate, setCourseRate, validCourseRateEdit, type CourseRate } from "@/db/courses";
import { todayInParis } from "@/domain/people/age";
import type { ActionResult } from "@/lib/action-result";
import { errorsOf } from "@/lib/form-errors";
import { requireRole } from "@/lib/session";

/**
 * Sets the instructor's rate for one of their courses from the instructor
 * page (#276), management only: `entry` is `{ rate, unit }`, the amount typed
 * in euros (empty: the usual rate) and the unit the page showed. Same rules as
 * the course form; a change is kept in the audit log (#191, #268).
 */
export async function saveCourseRate(
  instructorId: string,
  courseId: string,
  entry: unknown,
): Promise<ActionResult<{ rate: CourseRate | null }>> {
  const { schoolId, userId } = await requireRole("director");
  const parsed = validCourseRateEdit.safeParse(entry);
  if (!parsed.success) return { ok: false, message: errorsOf(parsed.error).rate ?? "Saisie invalide." };
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx) => {
    const saved = await setCourseRate(tx, instructorId, courseId, parsed.data, today);
    if (saved.ok) await logCourseRate(tx, userId, courseId, saved.before, saved.after);
    return saved;
  });
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath(`/intervenants/${instructorId}`);
  revalidatePath(`/planning/cours/${courseId}`);
  return { ok: true, rate: r.rate };
}
