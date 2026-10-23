"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ScheduleCourse } from "@/db/schedule";
import type { ScheduleLesson } from "@/db/lessons";
import type { Hours } from "@/domain/schedule/hours";
import { ages, end, DAYS, recurrenceBadge, recurrenceText } from "./format";
import { EMPTY_FILTERS, filterSchedule } from "./filters";
import { DatedWeek } from "./dated-week";
import { TypicalWeek } from "./typical-week";

export type ScheduleView = "datee" | "type" | "liste";
const VIEWS: Record<ScheduleView, string> = { datee: "Par semaine", type: "Semaine type", liste: "Liste" };

type Props = {
  courses: ScheduleCourse[];
  /** Management: each day offers « + » to create a course. */
  editable: boolean;
  /** Course just saved, highlighted in the grid. */
  highlighted?: string;
  /** Chosen view (`?vue=`): dated week by default (#90). */
  view: ScheduleView;
  /** Displayed dated week: its Monday, its lessons and its closures. */
  monday: string;
  today: string;
  lessons: ScheduleLesson[];
  closures: { label: string; start: string; end: string }[];
  /** Opening hours per site (#90): they bound the calendar. */
  hours: Record<string, Hours[]>;
};

/** Weekly schedule, filterable by discipline, site, room and instructor, with the headcount of each course. */
export function ScheduleGrid({
  courses: cours,
  editable: editable,
  highlighted: highlighted,
  view: initialView,
  hours: hours,
  monday: monday,
  today: today,
  lessons: lessons,
  closures: closures,
}: Props) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState(initialView);
  const chooseView = (v: ScheduleView) => {
    setView(v);
    window.history.replaceState(null, "", v === "datee" ? `/planning?semaine=${monday}` : `/planning?vue=${v}`);
  };
  const { discipline, site, roomId: roomId, instructorId: instructorId } = filters;
  const disciplines = useMemo(() => [...new Set(cours.map((c) => c.discipline))].sort(), [cours]);
  const sites = useMemo(() => [...new Set(cours.map((c) => c.site))].sort(), [cours]);
  const salles = [
    ...new Map(
      cours
        .filter((c) => !site || c.site === site)
        .map((c) => [c.roomId, { id: c.roomId, label: `${c.room} · ${c.site}` }]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label, "fr"));
  const instructors = [...new Map(cours.map((c) => [c.instructorId, c.instructor])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], "fr"),
  );
  const visible = filterSchedule(cours, filters);
  const activeFilters = Object.values(filters).some(Boolean);
  // Opening hours of the displayed sites: the filtered site (or the filtered room's site), otherwise all.
  const filteredSite = roomId
    ? cours.find((c) => c.roomId === roomId)?.siteId
    : site
      ? cours.find((c) => c.site === site)?.siteId
      : undefined;
  const displayedHours = filteredSite ? (hours[filteredSite] ?? []) : Object.values(hours).flat();
  const days = [...new Set(visible.map((c) => c.weekday))].sort((a, b) => (a ?? 8) - (b ?? 8));

  return (
    <div className="flex flex-col gap-4">
      <div className="panneau flex flex-wrap items-end gap-3 p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-discipline" className="text-xs text-doux">
            Discipline
          </label>
          <select
            id="filtre-discipline"
            className="champ"
            value={discipline}
            onChange={(e) => setFilters({ ...filters, discipline: e.target.value })}
          >
            <option value="">Toutes</option>
            {disciplines.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-site" className="text-xs text-doux">
            Site
          </label>
          <select
            id="filtre-site"
            className="champ"
            value={site}
            onChange={(e) => setFilters({ ...filters, site: e.target.value, roomId: "" })}
          >
            <option value="">Tous</option>
            {sites.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-salle" className="text-xs text-doux">
            Salle
          </label>
          <select
            id="filtre-salle"
            className="champ"
            value={roomId}
            onChange={(e) => setFilters({ ...filters, roomId: e.target.value })}
          >
            <option value="">Toutes les salles</option>
            {salles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-intervenant" className="text-xs text-doux">
            Intervenant
          </label>
          <select
            id="filtre-intervenant"
            className="champ"
            value={instructorId}
            onChange={(e) => setFilters({ ...filters, instructorId: e.target.value })}
          >
            <option value="">Tous les intervenants</option>
            {instructors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {activeFilters && (
          <button type="button" className="bouton-secondaire" onClick={() => setFilters(EMPTY_FILTERS)}>
            Réinitialiser les filtres
          </button>
        )}
        <p className="pb-1.5 text-sm text-doux" aria-live="polite">
          {visible.length} cours sur {cours.length}
        </p>
        <div
          role="group"
          aria-label="Affichage"
          className="ml-auto flex overflow-hidden rounded-md border border-bordure text-sm"
        >
          {(Object.keys(VIEWS) as ScheduleView[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={`px-3 py-1.5 ${view === v ? "bg-accent text-sur-accent" : "hover:bg-accent-doux"}`}
              onClick={() => chooseView(v)}
            >
              {VIEWS[v]}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="panneau flex flex-col items-start gap-3 p-5">
          <p className="text-sm text-doux">
            {cours.length === 0
              ? "Aucun cours n’est encore programmé."
              : "Aucun cours ne correspond à cette combinaison de filtres."}
          </p>
          {activeFilters && (
            <button type="button" className="bouton-secondaire" onClick={() => setFilters(EMPTY_FILTERS)}>
              Afficher tous les cours
            </button>
          )}
        </div>
      ) : view === "datee" ? (
        <DatedWeek
          lessons={filterSchedule(lessons, filters)}
          monday={monday}
          today={today}
          closures={closures}
          hours={displayedHours}
          editable={editable}
        />
      ) : view === "type" ? (
        <TypicalWeek
          courses={visible}
          tous={cours}
          editable={editable}
          highlighted={highlighted}
          hours={displayedHours}
        />
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {days.map((day) => (
            <section key={day ?? "stage"} aria-labelledby={`jour-${day ?? "stage"}`} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between border-b border-bordure pb-1">
                <h2 id={`jour-${day ?? "stage"}`} className="text-sm font-semibold">
                  {day ? DAYS[day] : "À dates précises"}
                </h2>
                {editable && day && (
                  <Link
                    href={`/planning/cours/nouveau?jour=${day}`}
                    className="lien -my-1 px-2 py-1 text-base"
                    aria-label={`Nouveau cours le ${DAYS[day].toLowerCase()}`}
                  >
                    +
                  </Link>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {visible
                  .filter((c) => c.weekday === day)
                  .map((c) => {
                    const full = c.maxCapacity !== null && c.enrolled >= c.maxCapacity;
                    const fill = c.maxCapacity ? Math.min(1, c.enrolled / c.maxCapacity) : 0;
                    return (
                      <li
                        key={c.id}
                        className={`panneau flex flex-col gap-0.5 px-2.5 py-2 text-sm ${c.id === highlighted ? "border-accent ring-1 ring-accent" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-medium">
                            <span className="tabular-nums">
                              {c.startTime}–{end(c.startTime, c.durationMinutes)}
                            </span>{" "}
                            <Link href={`/planning/cours/${c.id}`} className="lien">
                              {c.discipline}
                            </Link>
                          </p>
                          {full && (
                            <span className="rounded bg-alerte-fond px-1.5 text-xs font-medium text-alerte-texte">
                              Complet
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-doux">
                          {c.room}, {c.site} — {c.instructor}
                        </p>
                        {(c.weekday === null || recurrenceBadge(c)) && (
                          <p className="text-xs text-doux">
                            {c.weekday === null ? recurrenceText(c) : recurrenceBadge(c)}
                          </p>
                        )}
                        {(ages(c.ageMin, c.ageMax) || c.level) && (
                          <p className="text-xs text-doux">
                            {[ages(c.ageMin, c.ageMax), c.level].filter(Boolean).join(", ")}
                          </p>
                        )}
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          {c.maxCapacity ? (
                            <>
                              <span
                                className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent-doux"
                                role="img"
                                aria-label={`${c.enrolled} inscrits sur ${c.maxCapacity} places`}
                              >
                                <span
                                  className={`block h-full rounded-full ${full ? "bg-alerte-texte" : "bg-accent"}`}
                                  style={{ width: `${fill * 100}%` }}
                                />
                              </span>
                              <span className="tabular-nums text-doux">
                                {c.enrolled} / {c.maxCapacity}
                              </span>
                            </>
                          ) : (
                            <span className="text-doux">
                              {c.enrolled} inscrit{c.enrolled > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
