"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScheduleCourse } from "@/db/schedule";
import { toTime } from "@/domain/schedule/calendar";
import { calendarFrame, type Hours } from "@/domain/schedule/hours";
import { Calendar, type Slot, type CalendarElement, type CalendarResponse } from "./calendar";
import { move } from "./cours/actions";
import { end, DAYS, recurrenceBadge, recurrenceText } from "./format";

type Props = {
  /** Visible courses (filters applied). */
  courses: ScheduleCourse[];
  /** All courses of the season: a time range that stays stable whatever the filters. */
  tous: ScheduleCourse[];
  editable: boolean;
  highlighted?: string;
  hours: Hours[];
};

/**
 * Typical week of the season (#79): recurring courses at their day and
 * time; moving a course changes the course (and its upcoming lessons).
 * Courses on specific dates are listed below.
 */
export function TypicalWeek({
  courses: cours,
  tous,
  editable: editable,
  highlighted: highlighted,
  hours: hours,
}: Props) {
  const router = useRouter();
  const regular = cours.filter((c) => c.weekday !== null);
  const oneOff = cours.filter((c) => c.weekday === null);
  const { days: days, start: start, end: dayEnd } = calendarFrame(hours, tous);

  const elements: CalendarElement[] = regular.map((c) => ({
    id: c.id,
    weekday: c.weekday as number,
    startTime: c.startTime,
    durationMinutes: c.durationMinutes,
    title: c.discipline,
    rows: [
      `${c.room} · ${c.instructor}`,
      `${c.enrolled}${c.maxCapacity ? ` / ${c.maxCapacity}` : ""} inscrit${c.enrolled > 1 ? "s" : ""}`,
    ],
    tag: recurrenceBadge(c),
    alert: c.maxCapacity !== null && c.enrolled >= c.maxCapacity ? "complet" : null,
    href: `/planning/cours/${c.id}`,
    movable: true,
  }));

  const when = (c: Slot) => `${DAYS[c.weekday].toLowerCase()} ${c.startTime}–${end(c.startTime, c.durationMinutes)}`;
  async function moveCourse(id: string, slot: Slot, choice: string | null): Promise<CalendarResponse> {
    const c = cours.find((x) => x.id === id);
    const r = await move(id, slot, choice === "yes");
    if (r.status === "confirm") {
      return {
        status: "choose",
        question: `${c?.discipline} compte ${r.enrolled} élève${r.enrolled > 1 ? "s" : ""} inscrit${r.enrolled > 1 ? "s" : ""}. Passer au ${when(slot)} ? Les séances à venir suivent ; pensez à prévenir les familles.`,
        choice: [{ value: "yes", label: "Déplacer le cours" }],
      };
    }
    if (r.status === "refused") return r;
    return {
      status: "ok",
      text: `Cours déplacé — ${c?.discipline ?? "Cours"} : ${when(slot)}.`,
      warnings: r.warnings,
    };
  }

  return (
    <div className="flex flex-col gap-3">
      <Calendar
        elements={elements}
        columns={days.map((j) => ({ day: j, title: DAYS[j] }))}
        start={start}
        end={dayEnd}
        hours={hours}
        editable={editable}
        highlighted={highlighted}
        move={moveCourse}
        create={(day, d, duration) =>
          router.push(`/planning/cours/nouveau?jour=${day}&heure=${toTime(d)}&duree=${duration}`)
        }
      />
      {oneOff.length > 0 && (
        <section aria-labelledby="agenda-ponctuels" className="flex flex-col gap-1">
          <h2 id="agenda-ponctuels" className="text-sm font-semibold">
            À dates précises (stages, cours exceptionnels)
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {oneOff.map((s) => (
              <li key={s.id} className="panneau px-2.5 py-1.5">
                <Link href={`/planning/cours/${s.id}`} className="lien font-medium">
                  {s.discipline}
                </Link>{" "}
                <span className="text-doux">
                  {s.startTime}–{end(s.startTime, s.durationMinutes)}, {s.room} — {recurrenceText(s)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
