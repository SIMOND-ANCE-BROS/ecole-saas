"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScheduleLesson } from "@/db/lessons";
import { toTime } from "@/domain/schedule/calendar";
import { calendarFrame, type Hours } from "@/domain/schedule/hours";
import { addDays, weekDays, weekdayOf } from "@/domain/schedule/week";
import { moveOneLesson } from "./actions";
import { Calendar, type Slot, type CalendarElement, type CalendarResponse } from "./calendar";
import { shortDate, end } from "./format";

type Props = {
  /** Séances visibles de la semaine (filtres appliqués). */
  lessons: ScheduleLesson[];
  /** Lundi de la semaine affichée. */
  monday: string;
  today: string;
  closures: { label: string; start: string; end: string }[];
  hours: Hours[];
  editable: boolean;
};

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Planning daté, semaine par semaine (#90) : les vraies séances (déplacées,
 * remplacées, annulées) et les fermetures. Déplacer une séance d'un cours
 * régulier demande « cette séance seulement » ou « cette séance et les
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
      [s.moved && "déplacée", s.recurrence === "dates" && "ponctuel", s.recurrence === "quinzaine" && "1 sem. sur 2"]
        .filter(Boolean)
        .join(", ") || null,
    alert: s.status === "annulee" ? "annulée" : s.substitution ? "remplacement" : null,
    bar: s.status === "annulee",
    href: `/planning/seances/${s.id}`,
    movable: s.status === "prevue",
  }));
  const { days: days, start: start, end: dayEnd } = calendarFrame(hours, elements);
  const closedOn = (date: string) => closures.find((f) => f.start <= date && date <= f.end)?.label ?? null;

  async function moveLesson(id: string, slot: Slot, choice: string | null): Promise<CalendarResponse> {
    const s = lessons.find((x) => x.id === id);
    const date = dates[slot.weekday - 1];
    const when = `${shortDate(date, true)} ${slot.startTime}–${end(slot.startTime, slot.durationMinutes)}`;
    // Cours ponctuel : seule la séance existe ; cours régulier : demander la portée.
    if (!choice && s?.recurrence !== "dates") {
      return {
        status: "choisir",
        question: `Déplacer ${s?.discipline ?? "la séance"} au ${when} :`,
        choice: [
          { value: "seance", label: "Cette séance seulement" },
          { value: "suivantes", label: "Cette séance et les suivantes" },
        ],
      };
    }
    return moveOneLesson(
      id,
      { date, startTime: slot.startTime, durationMinutes: slot.durationMinutes },
      choice === "suivantes" ? "suivantes" : "seance",
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Semaines" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={weekLink(addDays(monday, -7))} className="bouton-secondaire" aria-label="Semaine précédente">
          ←
        </Link>
        <Link href={weekLink(addDays(monday, 7))} className="bouton-secondaire" aria-label="Semaine suivante">
          →
        </Link>
        <Link href={weekLink(addDays(today, 1 - weekdayOf(today)))} className="bouton-secondaire">
          Cette semaine
        </Link>
        <h2 className="font-semibold">
          Semaine du {shortDate(monday)} au {shortDate(dates[6])} {dates[6].slice(0, 4)}
        </h2>
        <label className="ml-auto flex items-center gap-2">
          <span className="text-doux">Aller au</span>
          <input
            type="date"
            className="champ"
            defaultValue={monday}
            onChange={(e) => e.target.value && router.push(weekLink(e.target.value))}
          />
        </label>
      </nav>
      {lessons.length === 0 && <p className="text-sm text-doux">Aucune séance cette semaine.</p>}
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
