"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScheduleCourse } from "@/db/planning";
import { toTime } from "@/domaine/planning/agenda";
import { calendarFrame, type Hours } from "@/domaine/planning/horaires";
import { Calendar, type Slot, type CalendarElement, type CalendarResponse } from "./agenda";
import { move } from "./cours/actions";
import { end, DAYS, recurrenceBadge, recurrenceText } from "./format";

type Props = {
  /** Cours visibles (filtres appliqués). */
  courses: ScheduleCourse[];
  /** Tous les cours de la saison : plage horaire stable quels que soient les filtres. */
  tous: ScheduleCourse[];
  editable: boolean;
  highlighted?: string;
  hours: Hours[];
};

/**
 * Semaine type de la saison (#79) : les cours réguliers à leur jour et leur
 * heure ; déplacer un cours change le cours (et ses séances à venir). Les
 * cours à dates précises sont listés dessous.
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
    const r = await move(id, slot, choice === "oui");
    if (r.status === "confirmer") {
      return {
        status: "choisir",
        question: `${c?.discipline} compte ${r.enrolled} élève${r.enrolled > 1 ? "s" : ""} inscrit${r.enrolled > 1 ? "s" : ""}. Passer au ${when(slot)} ? Les séances à venir suivent ; pensez à prévenir les familles.`,
        choice: [{ value: "oui", label: "Déplacer le cours" }],
      };
    }
    if (r.status === "refus") return r;
    return {
      status: "ok",
      texte: `Cours déplacé — ${c?.discipline ?? "Cours"} : ${when(slot)}.`,
      alertes: r.alertes,
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
