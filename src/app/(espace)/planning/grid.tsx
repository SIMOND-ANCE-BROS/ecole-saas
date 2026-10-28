"use client";

import { Anchor, Badge, Button, Paper, Progress, SegmentedControl, Select, Text, Title } from "@mantine/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ScheduleCourse } from "@/db/schedule";
import type { Closure, ScheduleLesson } from "@/db/lessons";
import type { Hours } from "@/domain/schedule/hours";
import { ages, end, DAYS, recurrenceBadge, recurrenceText } from "./format";
import { EMPTY_FILTERS, filterSchedule } from "./filters";
import { DatedWeek } from "./dated-week";
import { TypicalWeek } from "./typical-week";
import { type PlanningRoom, RoomsDay } from "./rooms-day";
import { calendarFrame } from "@/domain/schedule/hours";
import { withSeason } from "./season-link";

export type ScheduleView = "datee" | "type" | "salles" | "liste";
const VIEWS: Record<ScheduleView, string> = {
  datee: "Par semaine",
  type: "Semaine type",
  salles: "Par salle",
  liste: "Liste",
};

type Props = {
  courses: ScheduleCourse[];
  /** Management: each day offers « + » to create a course. */
  editable: boolean;
  /** Course just saved, highlighted in the grid. */
  highlighted?: string;
  /** Chosen view (`?vue=`): dated week by default (#90). */
  view: ScheduleView;
  /** Day of the « Par salle » view (`?jour=`, 1 = Monday); otherwise the first day of the week. */
  day: number;
  /** All rooms of the school, by site then name: the columns of « Par salle ». */
  rooms: PlanningRoom[];
  /** Displayed dated week: its Monday, its lessons and its closures. */
  monday: string;
  today: string;
  lessons: ScheduleLesson[];
  closures: Closure[];
  /** Opening hours per site (#90): they bound the calendar. */
  hours: Record<string, Hours[]>;
  /** Chosen season when it is not the current one (`?saison=`, #189), kept in links. */
  season?: string;
};

/** Weekly schedule, filterable by discipline, site, room and instructor, with the headcount of each course. */
export function ScheduleGrid({
  courses: cours,
  editable: editable,
  highlighted: highlighted,
  view: initialView,
  day: initialDay,
  rooms: allRooms,
  hours: hours,
  monday: monday,
  today: today,
  lessons: lessons,
  closures: closures,
  season,
}: Props) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState(initialView);
  const weekDays = calendarFrame(Object.values(hours).flat(), cours).days;
  const [day, setDay] = useState(weekDays.includes(initialDay) ? initialDay : (weekDays[0] ?? 1));
  const address = (v: ScheduleView, d: number) =>
    withSeason(
      v === "datee"
        ? `/planning?semaine=${monday}`
        : v === "salles"
          ? `/planning?vue=salles&jour=${d}`
          : `/planning?vue=${v}`,
      season,
    );
  const chooseView = (v: ScheduleView) => {
    setView(v);
    window.history.replaceState(null, "", address(v, day));
  };
  const chooseDay = (d: number) => {
    setDay(d);
    window.history.replaceState(null, "", address("salles", d));
  };
  const { discipline, site, roomId: roomId, instructorId: instructorId } = filters;
  const disciplines = useMemo(() => [...new Set(cours.map((c) => c.discipline))].sort(), [cours]);
  const sites = useMemo(() => [...new Set(cours.map((c) => c.site))].sort(), [cours]);
  const rooms = [
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
      <Paper withBorder p="sm" className="flex flex-wrap items-end gap-3">
        <Select
          label="Discipline"
          w={170}
          allowDeselect={false}
          data={[{ value: "", label: "Toutes" }, ...disciplines.map((d) => ({ value: d, label: d }))]}
          value={discipline}
          onChange={(d) => setFilters({ ...filters, discipline: d ?? "" })}
        />
        <Select
          label="Site"
          w={170}
          allowDeselect={false}
          data={[{ value: "", label: "Tous" }, ...sites.map((s) => ({ value: s, label: s }))]}
          value={site}
          onChange={(s) => setFilters({ ...filters, site: s ?? "", roomId: "" })}
        />
        <Select
          label="Salle"
          w={190}
          allowDeselect={false}
          data={[{ value: "", label: "Toutes les salles" }, ...rooms.map((s) => ({ value: s.id, label: s.label }))]}
          value={roomId}
          onChange={(r) => setFilters({ ...filters, roomId: r ?? "" })}
        />
        <Select
          label="Intervenant"
          w={190}
          allowDeselect={false}
          searchable
          data={[
            { value: "", label: "Tous les intervenants" },
            ...instructors.map(([id, name]) => ({ value: id, label: name })),
          ]}
          value={instructorId}
          onChange={(i) => setFilters({ ...filters, instructorId: i ?? "" })}
        />
        {activeFilters && (
          <Button variant="default" onClick={() => setFilters(EMPTY_FILTERS)}>
            Réinitialiser les filtres
          </Button>
        )}
        <Text size="sm" c="dimmed" pb={6} aria-live="polite">
          {visible.length} cours sur {cours.length}
        </Text>
        {/* Four views do not fit a phone width: the switcher scrolls there rather than overflowing. */}
        <div className="max-w-full overflow-x-auto sm:ml-auto">
          <SegmentedControl
            aria-label="Affichage"
            data={(Object.keys(VIEWS) as ScheduleView[]).map((v) => ({ value: v, label: VIEWS[v] }))}
            value={view}
            onChange={(v) => chooseView(v as ScheduleView)}
          />
        </div>
      </Paper>

      {visible.length === 0 ? (
        <Paper withBorder p="lg" className="flex flex-col items-start gap-3">
          <Text size="sm" c="dimmed">
            {cours.length === 0
              ? "Aucun cours n’est encore programmé."
              : "Aucun cours ne correspond à cette combinaison de filtres."}
          </Text>
          {activeFilters && (
            <Button variant="default" onClick={() => setFilters(EMPTY_FILTERS)}>
              Afficher tous les cours
            </Button>
          )}
        </Paper>
      ) : view === "datee" ? (
        <DatedWeek
          lessons={filterSchedule(lessons, filters)}
          monday={monday}
          today={today}
          closures={closures}
          hours={displayedHours}
          editable={editable}
          season={season}
        />
      ) : view === "salles" ? (
        <RoomsDay
          courses={visible}
          allCourses={cours}
          rooms={allRooms.filter((r) => (roomId ? r.id === roomId : !site || r.site === site))}
          day={day}
          days={weekDays}
          onDay={chooseDay}
          hours={hours}
          editable={editable}
          season={season}
          highlighted={highlighted}
        />
      ) : view === "type" ? (
        <TypicalWeek
          courses={visible}
          tous={cours}
          editable={editable}
          season={season}
          highlighted={highlighted}
          hours={displayedHours}
        />
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {days.map((day) => (
            <section key={day ?? "stage"} aria-labelledby={`jour-${day ?? "stage"}`} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between border-b border-bordure pb-1">
                <Title order={2} size="h6" id={`jour-${day ?? "stage"}`}>
                  {day ? DAYS[day] : "À dates précises"}
                </Title>
                {editable && day && (
                  <Button
                    component={Link}
                    href={withSeason(`/planning/cours/nouveau?jour=${day}`, season)}
                    size="compact-sm"
                    variant="subtle"
                    className="-my-1"
                    aria-label={`Nouveau cours le ${DAYS[day].toLowerCase()}`}
                  >
                    +
                  </Button>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {visible
                  .filter((c) => c.weekday === day)
                  .map((c) => {
                    const full = c.maxCapacity !== null && c.enrolled >= c.maxCapacity;
                    const fill = c.maxCapacity ? Math.min(1, c.enrolled / c.maxCapacity) : 0;
                    return (
                      <Paper
                        withBorder
                        component="li"
                        key={c.id}
                        className={`flex flex-col gap-0.5 px-2.5 py-2 text-sm ${c.id === highlighted ? "border-accent ring-1 ring-accent" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-medium">
                            <span className="tabular-nums">
                              {c.startTime}–{end(c.startTime, c.durationMinutes)}
                            </span>{" "}
                            <Anchor component={Link} href={`/planning/cours/${c.id}`} inherit>
                              {c.discipline}
                            </Anchor>
                          </p>
                          {full && (
                            <Badge color="yellow" variant="light" size="sm">
                              Complet
                            </Badge>
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
                              <Progress
                                className="flex-1"
                                size="sm"
                                role="img"
                                aria-label={`${c.enrolled} inscrits sur ${c.maxCapacity} places`}
                                color={full ? "yellow" : undefined}
                                value={fill * 100}
                              />
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
                      </Paper>
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
