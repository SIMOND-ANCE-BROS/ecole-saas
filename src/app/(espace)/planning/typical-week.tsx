"use client";

import { Anchor, Paper, Text, Title } from "@mantine/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScheduleCourse } from "@/db/schedule";
import { toTime } from "@/domain/schedule/calendar";
import { calendarFrame, type Hours } from "@/domain/schedule/hours";
import { Calendar, type Slot, type CalendarElement, type CalendarResponse } from "./calendar";
import { move } from "./cours/actions";
import { end, DAYS, recurrenceBadge, recurrenceText } from "./format";
import { withSeason } from "./season-link";

type Props = {
  /** Visible courses (filters applied). */
  courses: ScheduleCourse[];
  /** All courses of the season: a time range that stays stable whatever the filters. */
  allCourses: ScheduleCourse[];
  editable: boolean;
  highlighted?: string;
  hours: Hours[];
  /** Chosen season when it is not the current one (`?saison=`, #189), kept in links. */
  season?: string;
};

/**
 * Typical week of the season (#79): recurring courses at their day and
 * time; moving a course changes the course (and its upcoming lessons).
 * Courses on specific dates are listed below.
 */
export function TypicalWeek({ courses, allCourses, editable, highlighted, hours, season }: Props) {
  const router = useRouter();
  const regular = courses.filter((c) => c.weekday !== null);
  const oneOff = courses.filter((c) => c.weekday === null);
  const { days, start, end: dayEnd } = calendarFrame(hours, allCourses);

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
    const c = courses.find((x) => x.id === id);
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
          router.push(withSeason(`/planning/cours/nouveau?jour=${day}&heure=${toTime(d)}&duree=${duration}`, season))
        }
      />
      {oneOff.length > 0 && (
        <section aria-labelledby="agenda-ponctuels" className="flex flex-col gap-1">
          <Title order={2} size="h6" id="agenda-ponctuels">
            À dates précises (stages, cours exceptionnels)
          </Title>
          <ul className="flex flex-col gap-1 text-sm">
            {oneOff.map((s) => (
              <Paper withBorder component="li" key={s.id} className="px-2.5 py-1.5">
                <Anchor component={Link} href={`/planning/cours/${s.id}`} inherit fw={500}>
                  {s.discipline}
                </Anchor>{" "}
                <Text span inherit c="dimmed">
                  {s.startTime}–{end(s.startTime, s.durationMinutes)}, {s.room} — {recurrenceText(s)}
                </Text>
              </Paper>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
