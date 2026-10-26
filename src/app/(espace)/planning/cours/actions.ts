"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withSchool } from "@/db";
import { createCourse, moveCourse, readCourse, updateCourse, validCourseInput, deleteCourse } from "@/db/courses";
import { slotConflicts } from "@/db/unavailabilities";
import { hoursBySite } from "@/db/settings";
import { seasonCourses, currentSeason } from "@/db/schedule";
import { seasonCalendar, syncLessons } from "@/db/lessons";
import { lessonDatesOf } from "@/domain/schedule/lessons";
import { conflicts } from "@/domain/schedule/overlap";
import { outsideHours } from "@/domain/schedule/hours";
import { SHORT_DAYS } from "@/domain/schedule/days";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { topErrorsOf } from "@/lib/form-errors";
import type { z } from "zod";

export type Refusal = { message: string; errors: Partial<Record<keyof CourseFields, string>> };
type CourseFields = z.input<typeof validCourseInput>;

/** Creates (null id) or updates a course of the current season; management only. */
export async function saveCourse(id: string | null, entry: unknown): Promise<Refusal> {
  const { schoolId: schoolId } = await requireRole("director");
  const parsed = validCourseInput.safeParse(entry);
  if (!parsed.success) {
    return { message: "Vérifiez les champs signalés.", errors: topErrorsOf(parsed.error) };
  }
  const today = todayInParis();
  const result = await withSchool(schoolId, async (tx) => {
    const seasonId = id !== null ? (await readCourse(tx, id))?.seasonId : (await currentSeason(tx, today))?.id;
    if (!seasonId)
      return {
        ok: false as const,
        message: id !== null ? "Ce cours n’existe plus." : "Aucune saison n’est paramétrée.",
      };
    const r = id !== null ? await updateCourse(tx, id, parsed.data) : await createCourse(tx, seasonId, parsed.data);
    // Upcoming lessons recomputed in the same transaction (day changed, new course…).
    if (r.ok) await syncLessons(tx, seasonId, today);
    return r;
  });
  if (!result.ok) return { message: result.message, errors: {} };
  redirect(id === null ? `/planning?enregistre=${result.id}` : `/planning/cours/${result.id}?modifie=1`);
}

export async function remove(id: string): Promise<Refusal> {
  const { schoolId: schoolId } = await requireRole("director");
  const result = await withSchool(schoolId, (tx) => deleteCourse(tx, id));
  if (!result.ok) return { message: result.message, errors: {} };
  redirect("/planning?supprime=1");
}

/** Upcoming dates when the chosen instructor would be unavailable for this slot (while typing). */
export async function checkSlot(
  courseId: string | null,
  slot: { instructorId: string; weekday: number; startTime: string; durationMinutes: number },
): Promise<string[]> {
  const { schoolId: schoolId } = await requireRole("director");
  const today = todayInParis();
  return withSchool(schoolId, async (tx) => {
    const seasonId = courseId ? (await readCourse(tx, courseId))?.seasonId : (await currentSeason(tx, today))?.id;
    return seasonId ? slotConflicts(tx, { ...slot, seasonId }, today) : [];
  });
}

export type MoveResponse =
  | { status: "ok"; warnings: string[] }
  | { status: "confirm"; enrolled: number }
  | { status: "refused"; message: string };

const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Drag and drop from the calendar view: new day, time or length. Upcoming
 * lessons follow; the result reports a room or instructor already taken and the
 * instructor's unavailabilities for this slot.
 */
export async function move(courseId: string, slot: unknown, confirmed: boolean): Promise<MoveResponse> {
  const { schoolId: schoolId } = await requireRole("director");
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx) => {
    const d = await moveCourse(tx, courseId, slot as Parameters<typeof moveCourse>[2], confirmed);
    if (d.status !== "ok") return d;
    const c = await readCourse(tx, courseId);
    if (!c) return { status: "refused" as const, message: "Ce cours n’existe plus." };
    await syncLessons(tx, c.seasonId, today);
    const calendar = await seasonCalendar(tx, c.seasonId, today);
    const schedule = (await seasonCourses(tx, c.seasonId)).map((p) => ({
      ...p,
      lessonDates: calendar ? lessonDatesOf(p, calendar) : undefined,
    }));
    const me = schedule.find((p) => p.id === courseId);
    const warnings = me
      ? conflicts(me, schedule).map((x) => {
          const other = schedule.find((p) => p.id === x.id)!;
          // A workshop has no weekday: name the first date both share.
          const shared = other.lessonDates?.find((d) => me.lessonDates?.includes(d));
          const day =
            other.weekday === null && shared
              ? shortDate.format(new Date(`${shared}T00:00:00Z`))
              : SHORT_DAYS[other.weekday ?? 0];
          const when = `${other.discipline}, ${day} ${other.startTime}`;
          if (x.room && x.instructor) return `${other.room} et ${other.instructor} déjà pris (${when})`;
          return x.room ? `${other.room} déjà occupée (${when})` : `${other.instructor} donne déjà un cours (${when})`;
        })
      : [];
    if (me && c.weekday) {
      const outside = outsideHours(
        { weekday: c.weekday, startTime: c.startTime, durationMinutes: c.durationMinutes },
        (await hoursBySite(tx))[me.siteId] ?? [],
      );
      if (outside) warnings.push(outside);
    }
    if (c.weekday) {
      const dates = await slotConflicts(
        tx,
        {
          seasonId: c.seasonId,
          instructorId: c.instructorId,
          weekday: c.weekday,
          startTime: c.startTime,
          durationMinutes: c.durationMinutes,
        },
        today,
      );
      if (dates.length > 0) {
        warnings.push(
          `Intervenant indisponible le ${dates
            .slice(0, 4)
            .map((x) => shortDate.format(new Date(`${x}T00:00:00Z`)))
            .join(", ")}${dates.length > 4 ? "…" : ""}`,
        );
      }
    }
    return { status: "ok" as const, warnings };
  });
  revalidatePath("/planning");
  return r;
}
