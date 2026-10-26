"use client";

import { useRouter } from "next/navigation";
import type { ScheduleCourse } from "@/db/schedule";
import { toTime } from "@/domain/schedule/calendar";
import { calendarFrame, type Hours } from "@/domain/schedule/hours";
import { Calendar, type CalendarElement, type CalendarResponse, type Slot } from "./calendar";
import { move } from "./cours/actions";
import { DAYS, end, recurrenceBadge } from "./format";

export type PlanningRoom = { id: string; name: string; siteId: string; site: string };

type Props = {
  /** Visible courses (filters applied). */
  courses: ScheduleCourse[];
  /** All courses of the season: a time range that stays stable whatever the filters. */
  tous: ScheduleCourse[];
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
};

/**
 * One day of the typical week, one column per room (#85): two courses in the
 * same column at the same time share a room. Moving a course to another column
 * changes its room (checked on the server); a free slot creates a course there.
 *
 * The calendar positions columns by number: column i (from 1) is `rooms[i - 1]`.
 */
export function RoomsDay({ courses, tous, rooms, day, days, onDay, hours, editable, highlighted }: Props) {
  const router = useRouter();
  const column = new Map(rooms.map((r, i) => [r.id, i + 1]));
  const severalSites = new Set(rooms.map((r) => r.siteId)).size > 1;
  const { start, end: dayEnd } = calendarFrame(Object.values(hours).flat(), tous);

  const elements: CalendarElement[] = courses
    .filter((c) => c.weekday === day && column.has(c.roomId))
    .map((c) => ({
      id: c.id,
      weekday: column.get(c.roomId) as number,
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
    }));
  // Each room column greys out the closed hours of its own site on that day.
  const columnHours = rooms.flatMap((r, i) =>
    (hours[r.siteId] ?? []).filter((h) => h.weekday === day).map((h) => ({ ...h, weekday: i + 1 })),
  );

  async function moveCourse(id: string, slot: Slot, choice: string | null): Promise<CalendarResponse> {
    const c = courses.find((x) => x.id === id);
    const target = rooms[slot.weekday - 1];
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
      <div role="group" aria-label="Jour" className="flex flex-wrap gap-1">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === day}
            className="rounded-md border border-bordure px-3 py-1.5 text-sm aria-pressed:border-accent aria-pressed:bg-accent-doux aria-pressed:font-medium"
            onClick={() => onDay(d)}
          >
            {DAYS[d]}
          </button>
        ))}
      </div>
      {rooms.length === 0 ? (
        <p className="text-sm text-doux">Aucune salle pour ces filtres.</p>
      ) : (
        <Calendar
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
              `/planning/cours/nouveau?jour=${day}&heure=${toTime(d)}&duree=${duration}&salle=${rooms[col - 1].id}`,
            )
          }
        />
      )}
    </div>
  );
}
