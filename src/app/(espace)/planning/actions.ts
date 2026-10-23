"use server";

import { revalidatePath } from "next/cache";
import { withSchool } from "@/db";
import { hoursBySite } from "@/db/settings";
import { moveLesson, weekLessons, syncLessons } from "@/db/lessons";
import { conflicts } from "@/domain/schedule/overlap";
import { outsideHours } from "@/domain/schedule/hours";
import { todayInParis } from "@/domain/people/age";
import { weekdayOf, mondayOf } from "@/domain/schedule/week";
import { requireRole } from "@/lib/session";
import type { CalendarResponse } from "./calendar";
import { shortDate, end } from "./format";

/**
 * Moves a lesson of the dated schedule (#90): « seance » (that one only) or
 * « suivantes » (the course changes from that lesson on). Then reports a room
 * or instructor already taken that day and a slot outside the site's opening
 * hours.
 */
export async function moveOneLesson(
  lessonId: string,
  slot: { date: string; startTime: string; durationMinutes: number },
  scope: "seance" | "suivantes",
): Promise<CalendarResponse> {
  const { schoolId: schoolId } = await requireRole("direction");
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx): Promise<CalendarResponse> => {
    const d = await moveLesson(tx, lessonId, slot, scope);
    if (d.status === "refus") return d;
    if (d.since) await syncLessons(tx, d.seasonId, today, d.since);

    const week = await weekLessons(tx, mondayOf(slot.date));
    const day = week
      .filter((s) => s.date === slot.date && s.status !== "annulee")
      .map((s) => ({ ...s, weekday: weekdayOf(s.date) }));
    const me = day.find(
      (s) => s.courseId === week.find((x) => x.id === lessonId)?.courseId && s.startTime === slot.startTime,
    );
    const alertes: string[] = [];
    if (me) {
      for (const x of conflicts(me, day)) {
        const autre = day.find((s) => s.id === x.id)!;
        const when = `${autre.discipline} à ${autre.startTime}`;
        alertes.push(
          x.room && x.instructor
            ? `${autre.room} et ${autre.instructor} déjà pris (${when})`
            : x.room
              ? `${autre.room} déjà occupée (${when})`
              : `${autre.instructor} donne déjà un cours (${when})`,
        );
      }
      const outside = outsideHours(
        { weekday: me.weekday, startTime: me.startTime, durationMinutes: me.durationMinutes },
        (await hoursBySite(tx))[me.siteId] ?? [],
      );
      if (outside) alertes.push(outside);
    }
    const when = `${shortDate(slot.date, true)} ${slot.startTime}–${end(slot.startTime, slot.durationMinutes)}`;
    return {
      status: "ok",
      text:
        scope === "seance"
          ? `Séance déplacée au ${when}.`
          : `Cours déplacé à partir du ${when} : les séances suivantes suivent.`,
      alertes,
    };
  });
  revalidatePath("/planning");
  return r;
}
