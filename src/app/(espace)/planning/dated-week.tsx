"use client";

import { Button, Group, Text, Title } from "@mantine/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScheduleLesson } from "@/db/lessons";
import { toTime } from "@/domain/schedule/calendar";
import { calendarFrame, type Hours } from "@/domain/schedule/hours";
import { addDays, weekDays, weekdayOf } from "@/domain/schedule/week";
import { moveOneLesson } from "./actions";
import { Calendar, type Slot, type CalendarElement, type CalendarResponse } from "./calendar";
import { shortDate, end } from "./format";
import { DateField } from "../_ui/date-field";

type Props = {
  /** Visible lessons of the week (filters applied). */
  lessons: ScheduleLesson[];
  /** Monday of the displayed week. */
  monday: string;
  today: string;
  closures: { label: string; start: string; end: string }[];
  hours: Hours[];
  editable: boolean;
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
  hours: hours,
  editable: editable,
}: Props) {
  const router = useRouter();
  const dates = weekDays(monday);
  const weekLink = (l: string) => `/planning?semaine=${l}`;

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
    alert: s.status === "cancelled" ? "annulée" : s.substitution ? "remplacement" : null,
    bar: s.status === "cancelled",
    href: `/planning/seances/${s.id}`,
    movable: s.status === "planned",
  }));
  const { days: days, start: start, end: dayEnd } = calendarFrame(hours, elements);
  const closedOn = (date: string) => closures.find((f) => f.start <= date && date <= f.end)?.label ?? null;

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
        <Button component={Link} href={weekLink(addDays(today, 1 - weekdayOf(today)))} variant="default">
          Cette semaine
        </Button>
        <Title order={2} size="h5">
          Semaine du {shortDate(monday)} au {shortDate(dates[6])} {dates[6].slice(0, 4)}
        </Title>
        <Group gap="xs" className="ml-auto">
          <Text span size="sm" c="dimmed" id="aller-au">
            Aller au
          </Text>
          <DateField
            aria-labelledby="aller-au"
            w={140}
            value={monday}
            onChange={(d) => d && router.push(weekLink(d))}
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
        }))}
        start={start}
        end={dayEnd}
        hours={hours}
        editable={editable}
        move={moveLesson}
        create={(day, d, duration) =>
          router.push(`/planning/cours/nouveau?jour=${day}&heure=${toTime(d)}&duree=${duration}&date=${dates[day - 1]}`)
        }
      />
    </div>
  );
}
