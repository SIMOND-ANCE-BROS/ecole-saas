"use client";

import { SegmentedControl } from "@mantine/core";
import { useRouter } from "next/navigation";
import type { ScheduleCourse } from "@/db/schedule";
import { toTime } from "@/domain/schedule/calendar";
import { calendarFrame, type Hours } from "@/domain/schedule/hours";
import { Calendar, type CalendarElement, type CalendarResponse, type Slot } from "./calendar";
import { move } from "./cours/actions";
import { DAYS, end, recurrenceBadge } from "./format";
import { withSeason } from "./season-link";

export type PlanningRoom = { id: string; name: string; siteId: string; site: string };

type Props = {
  /** Visible courses (filters applied). */
  courses: ScheduleCourse[];
  /** All courses of the season: a time range that stays stable whatever the filters. */
  allCourses: ScheduleCourse[];
  /** Rooms shown as columns, by site then name (empty rooms included: a course can be created there). */
  rooms: PlanningRoom[];
  /** 1 = Monday … 7 = Sunday. */
  day: number;
  /** Days offered by the day picker. */
  days: number[];
  onDay: (day: number) => void;
  /** Opening hours per site. */
  hours: Record<string, Hours[]>;
  editable: boolean;
  highlighted?: string;
  /** Chosen season when it is not the current one (`?saison=`, #189), kept in links. */
  season?: string;
};

/**
 * One day of the typical week, one column per room (#85): two courses in the
 * same column at the same time share a room. Moving a course to another column
 * changes its room (checked on the server); a free slot creates a course there.
 *
 * The calendar positions columns by number: column i (from 1) is `rooms[i - 1]`.
 */
export function RoomsDay({
  courses,
  allCourses,
  rooms,
  day,
  days,
  onDay,
  hours,
  editable,
  highlighted,
  season,
}: Props) {
  const router = useRouter();
  const column = new Map(rooms.map((r, i) => [r.id, i + 1]));
  const severalSites = new Set(rooms.map((r) => r.siteId)).size > 1;
  const { start, end: dayEnd } = calendarFrame(Object.values(hours).flat(), allCourses);

  const elements: CalendarElement[] = courses.flatMap((c) => {
    const col = column.get(c.roomId);
    if (c.weekday !== day || col === undefined) return [];
    return {
      id: c.id,
      weekday: col,
      startTime: c.startTime,
      durationMinutes: c.durationMinutes,
      title: c.discipline,
      rows: [
        c.instructor,
        `${c.enrolled}${c.maxCapacity ? ` / ${c.maxCapacity}` : ""} inscrit${c.enrolled > 1 ? "s" : ""}`,
      ],
      tag: recurrenceBadge(c),
      alert: c.maxCapacity !== null && c.enrolled >= c.maxCapacity ? "complet" : null,
      href: `/planning/cours/${c.id}`,
      movable: true,
    };
  });
  // Each room column greys out the closed hours of its own site on that day; a site without
  // opening hours imposes nothing (domain/schedule/hours), so its columns stay open all day.
  const columnHours = rooms.flatMap((r, i) => {
    const site = hours[r.siteId];
    if (!site?.length) return [{ weekday: i + 1, opening: "00:00", closure: "23:59" }];
    return site.filter((h) => h.weekday === day).map((h) => ({ ...h, weekday: i + 1 }));
  });

  async function moveCourse(id: string, slot: Slot, choice: string | null): Promise<CalendarResponse> {
    const c = courses.find((x) => x.id === id);
    const target = rooms[slot.weekday - 1];
    if (!target) return { status: "refused", message: "Cette salle n’est plus affichée." };
    const when = `${DAYS[day].toLowerCase()} ${slot.startTime}–${end(slot.startTime, slot.durationMinutes)}, ${target.name}`;
    const r = await move(
      id,
      { weekday: day, startTime: slot.startTime, durationMinutes: slot.durationMinutes, roomId: target.id },
      choice === "yes",
    );
    if (r.status === "confirm") {
      return {
        status: "choose",
        question: `${c?.discipline} compte ${r.enrolled} élève${r.enrolled > 1 ? "s" : ""} inscrit${r.enrolled > 1 ? "s" : ""}. Passer au ${when} ? Les séances à venir suivent ; pensez à prévenir les familles.`,
        choice: [{ value: "yes", label: "Déplacer le cours" }],
      };
    }
    if (r.status === "refused") return r;
    return { status: "ok", text: `Cours déplacé — ${c?.discipline ?? "Cours"} : ${when}.`, warnings: r.warnings };
  }

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        aria-label="Jour"
        className="self-start"
        value={String(day)}
        onChange={(d) => onDay(Number(d))}
        data={days.map((d) => ({ value: String(d), label: DAYS[d] }))}
      />
      {rooms.length === 0 ? (
        <p className="text-sm text-doux">Aucune salle pour ces filtres.</p>
      ) : (
        <Calendar
          // New day or new columns: a pending move or confirmation refers to old column numbers, it is dropped.
          key={`${day}:${rooms.map((r) => r.id).join()}`}
          elements={elements}
          columns={rooms.map((r, i) => ({ day: i + 1, title: severalSites ? `${r.name} · ${r.site}` : r.name }))}
          start={start}
          end={dayEnd}
          hours={columnHours}
          editable={editable}
          highlighted={highlighted}
          move={moveCourse}
          create={(col, d, duration) =>
            router.push(
              withSeason(
                `/planning/cours/nouveau?jour=${day}&heure=${toTime(d)}&duree=${duration}&salle=${rooms[col - 1].id}`,
                season,
              ),
            )
          }
        />
      )}
    </div>
  );
}
