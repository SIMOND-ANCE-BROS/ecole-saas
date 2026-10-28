"use client";

import { Button, Group, Text, Title } from "@mantine/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Closure, ScheduleLesson } from "@/db/lessons";
import type { ScheduleCourse } from "@/db/schedule";
import { covers } from "@/domain/schedule/closure-scope";
import { meetsOn, type Period } from "@/domain/schedule/lessons";
import { toTime } from "@/domain/schedule/calendar";
import { calendarFrame, type Hours } from "@/domain/schedule/hours";
import { addDays, weekDays, weekdayOf } from "@/domain/schedule/week";
import { moveOneLesson } from "./actions";
import { Calendar, type Slot, type CalendarElement, type CalendarResponse } from "./calendar";
import { shortDate, end } from "./format";
import { DateField } from "../_ui/date-field";
import { withSeason } from "./season-link";

type Props = {
  /** Visible lessons of the week (filters applied). */
  lessons: ScheduleLesson[];
  /** Monday of the displayed week. */
  monday: string;
  today: string;
  /** Closures touching the week, each with what it covers (#200). */
  closures: Closure[];
  /** Courses and dates of the season shown: a partial closure is noted only on the days it takes a lesson away. */
  courses: ScheduleCourse[];
  seasonPeriod: Period;
  hours: Hours[];
  editable: boolean;
  /** Chosen season when it is not the current one (`?saison=`, #189), kept in links. */
  season?: string;
};

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Dated schedule, week by week (#90): the actual lessons (moved, replaced,
 * cancelled) and the closures. Moving a lesson of a recurring course asks
 * « cette séance seulement » or « cette séance et les
 * suivantes ».
 */
export function DatedWeek({
  lessons: lessons,
  monday: monday,
  today: today,
  closures: closures,
  courses,
  seasonPeriod,
  hours: hours,
  editable: editable,
  season,
}: Props) {
  const router = useRouter();
  // « Aller au » is drawn again for the new week: it takes the focus back once (#220).
  const [goToFocus, setGoToFocus] = useState(false);
  const dates = weekDays(monday);
  const weekLink = (l: string) => withSeason(`/planning?semaine=${l}`, season);

  const on = (date: string) => closures.filter((f) => f.period.start <= date && date <= f.period.end);
  // A lesson kept during a partial closure (attendance already taken) says so. Like the
  // lesson sync, a moved lesson is judged on its original date; a school-wide closure
  // never removes a one-off course, so it is not flagged either. Limit: only this week's
  // closures are loaded, so a lesson moved in from another week is not checked against
  // a closure of its original week.
  const closedFor = (s: ScheduleLesson) =>
    on(s.plannedDate).find((f) => f.scope.kind !== "school" && covers(f.scope, { id: s.courseId, siteId: s.siteId }))
      ?.label;

  const elements: CalendarElement[] = lessons.map((s) => ({
    id: s.id,
    weekday: weekdayOf(s.date),
    startTime: s.startTime,
    durationMinutes: s.durationMinutes,
    title: s.discipline,
    rows: [
      `${s.room} · ${s.instructor}`,
      `${s.enrolled}${s.maxCapacity ? ` / ${s.maxCapacity}` : ""} inscrit${s.enrolled > 1 ? "s" : ""}`,
    ],
    tag:
      [s.moved && "déplacée", s.recurrence === "dates" && "ponctuel", s.recurrence === "biweekly" && "1 sem. sur 2"]
        .filter(Boolean)
        .join(", ") || null,
    alert:
      s.status === "cancelled"
        ? "annulée"
        : closedFor(s)
          ? `fermé : ${closedFor(s)}`
          : s.substitution
            ? "remplacement"
            : null,
    bar: s.status === "cancelled",
    href: `/planning/seances/${s.id}`,
    movable: s.status === "planned",
  }));
  const { days: days, start: start, end: dayEnd } = calendarFrame(hours, elements);
  // The whole school closed: the day is hatched; closed only for some sites or courses: a note says which.
  const closedOn = (date: string) => on(date).find((f) => f.scope.kind === "school")?.label ?? null;
  // Noted only where a covered course would have met that day: « Site Centre fermé », « Jazz annulé ».
  const partlyClosedOn = (date: string) => {
    const notes = on(date).flatMap((f) => {
      if (f.scope.kind === "school") return [];
      const scope = f.scope;
      const hit = courses.filter((c) => covers(scope, c) && meetsOn(c, seasonPeriod, date));
      if (hit.length === 0) return [];
      // Only the sites where a course would have met that day.
      const sites = [...new Set(hit.map((c) => c.site))];
      const text =
        scope.kind === "sites"
          ? `${sites.join(", ")} fermé${sites.length > 1 ? "s" : ""}`
          : hit.length === 1
            ? `${hit[0].discipline} annulé`
            : `${hit.length} cours annulés`;
      return [{ text, title: `${f.label} : ${f.targets.join(", ")}` }];
    });
    return notes.length === 0
      ? null
      : { text: notes.map((n) => n.text).join(" · "), title: notes.map((n) => n.title).join("\n") };
  };

  async function moveLesson(id: string, slot: Slot, choice: string | null): Promise<CalendarResponse> {
    const s = lessons.find((x) => x.id === id);
    const date = dates[slot.weekday - 1];
    const when = `${shortDate(date, true)} ${slot.startTime}–${end(slot.startTime, slot.durationMinutes)}`;
    // One-off course: only the lesson exists; recurring course: ask for the scope.
    if (!choice && s?.recurrence !== "dates") {
      return {
        status: "choose",
        question: `Déplacer ${s?.discipline ?? "la séance"} au ${when} :`,
        choice: [
          { value: "lesson", label: "Cette séance seulement" },
          { value: "following", label: "Cette séance et les suivantes" },
        ],
      };
    }
    return moveOneLesson(
      id,
      { date, startTime: slot.startTime, durationMinutes: slot.durationMinutes },
      choice === "following" ? "following" : "lesson",
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Semaines" className="flex flex-wrap items-center gap-2 text-sm">
        <Button component={Link} href={weekLink(addDays(monday, -7))} variant="default" aria-label="Semaine précédente">
          ←
        </Button>
        <Button component={Link} href={weekLink(addDays(monday, 7))} variant="default" aria-label="Semaine suivante">
          →
        </Button>
        {/* Today's week belongs to the current season: back to it, without `?saison=`. */}
        <Button component={Link} href={`/planning?semaine=${addDays(today, 1 - weekdayOf(today))}`} variant="default">
          Cette semaine
        </Button>
        <Title order={2} size="h5">
          Semaine du {shortDate(monday)} au {shortDate(dates[6])} {dates[6].slice(0, 4)}
        </Title>
        <Group gap="xs" className="ml-auto">
          <Text span size="sm" c="dimmed" id="aller-au">
            Aller au
          </Text>
          <GoTo
            key={monday}
            monday={monday}
            focus={goToFocus}
            onFocused={() => setGoToFocus(false)}
            onGo={(d) => {
              setGoToFocus(true);
              router.push(weekLink(d));
            }}
          />
        </Group>
      </nav>
      {lessons.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucune séance cette semaine.
        </Text>
      )}
      <Calendar
        elements={elements}
        columns={days.map((j) => ({
          day: j,
          title: capital(shortDate(dates[j - 1], true)),
          closed: closedOn(dates[j - 1]),
          note: partlyClosedOn(dates[j - 1]),
        }))}
        start={start}
        end={dayEnd}
        hours={hours}
        editable={editable}
        move={moveLesson}
        create={(day, d, duration) =>
          router.push(
            withSeason(
              `/planning/cours/nouveau?jour=${day}&heure=${toTime(d)}&duree=${duration}&date=${dates[day - 1]}`,
              season,
            ),
          )
        }
      />
    </div>
  );
}

/**
 * « Aller au »: shows the Monday of the week and moves only once a date is
 * settled (Enter, leaving the field, a day picked), never on a half-typed
 * year such as « 12/09/20 ».
 */
function GoTo({
  monday,
  focus,
  onFocused,
  onGo,
}: {
  monday: string;
  /** Drawn for the week it led to: takes the focus, calendar closed. */
  focus: boolean;
  onFocused: () => void;
  onGo: (date: string) => void;
}) {
  // Remounted for each week (key): whatever was typed, even with the cursor
  // still here when the browser goes back, gives way to the Monday shown.
  const [date, setDate] = useState(monday);
  useEffect(() => {
    const field = document.querySelector<HTMLInputElement>('input[aria-labelledby="aller-au"]');
    if (!focus || !field) return;
    // Without opening the calendar again over the new week (see `DateField`).
    field.dataset.quietFocus = "1";
    field.focus();
    onFocused();
    // Once, when this week's field appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <DateField
      aria-labelledby="aller-au"
      // Picking the selected day again changes nothing rather than emptying the field.
      required
      w={140}
      value={date}
      onChange={setDate}
      onCommit={(d) => {
        if (addDays(d, 1 - weekdayOf(d)) !== monday) onGo(d);
      }}
    />
  );
}
