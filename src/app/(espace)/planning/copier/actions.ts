"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withSchool } from "@/db";
import { syncLessons } from "@/db/lessons";
import { currentSeason } from "@/db/schedule";
import { copySeason } from "@/db/season-copy";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { seasonParam, withSeason } from "../season-link";

/**
 * Copies the courses of `sourceId` into `targetId` (#190), then generates
 * their lessons in the same transaction, as for a course created by hand.
 * Management only; both ids come from the browser and are checked under RLS.
 */
export async function copyPlanning(sourceId: unknown, targetId: unknown): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("director");
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx) => {
    const c = await copySeason(tx, userId, sourceId, targetId);
    if (!c.ok) return c;
    await syncLessons(tx, c.target.id, today);
    return { ...c, season: seasonParam(c.target.id, (await currentSeason(tx, today))?.id) };
  });
  if (!r.ok) return { message: r.message };
  revalidatePath("/planning");
  redirect(withSeason(`/planning?copie=${r.copied}`, r.season));
}
