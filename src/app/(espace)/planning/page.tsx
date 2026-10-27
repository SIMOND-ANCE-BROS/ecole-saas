import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { hoursBySite, listPlaces } from "@/db/settings";
import { chosenSeason, currentSeason, schoolSeasons, seasonCourses, seasonOverlapping } from "@/db/schedule";
import { closuresBetween, weekLessons } from "@/db/lessons";
import { addDays, validDate, mondayOf } from "@/domain/schedule/week";
import { todayInParis } from "@/domain/people/age";
import { schoolContext } from "@/lib/session";
import { ButtonLink } from "../_ui/button-link";
import { ScheduleGrid } from "./grid";
import { seasonParam as paramOf, withSeason } from "./season-link";
import { SeasonPicker } from "./season-picker";

export const metadata: Metadata = { title: "Planning" };

export default async function SchedulePage({ searchParams }: PageProps<"/planning">) {
  const { schoolId: schoolId, role } = await schoolContext();
  const { enregistre, supprime, vue, semaine, jour, saison } = await searchParams;
  const today = todayInParis();
  const {
    season: season,
    moved,
    outside,
    current,
    seasons,
    monday,
    courses: cours,
    hours: hours,
    lessons: lessons,
    closures: closures,
    places,
  } = await withSchool(schoolId, async (tx) => {
    const asked = await chosenSeason(tx, saison, today);
    const week = validDate(semaine);
    // Another season opens on its first week, unless a week is asked for.
    const shownDay = week ?? (asked && (today < asked.startDate || today > asked.endDate) ? asked.startDate : today);
    const monday = mondayOf(shownDay);
    // A week asked for outside the chosen season shows the season it belongs
    // to; a week in no season (summer) keeps the chosen one, with a notice.
    const inAsked = asked && asked.startDate <= addDays(monday, 6) && asked.endDate >= monday;
    const weekSeason = week && asked && !inAsked ? await seasonOverlapping(tx, monday, addDays(monday, 6)) : null;
    const s = weekSeason ?? asked;
    return {
      season: s,
      moved: weekSeason !== null,
      outside: !!week && !!asked && !inAsked && weekSeason === null,
      current: await currentSeason(tx, today),
      seasons: await schoolSeasons(tx),
      monday,
      courses: s ? await seasonCourses(tx, s.id) : [],
      hours: await hoursBySite(tx),
      lessons: await weekLessons(tx, monday),
      closures: await closuresBetween(tx, monday, addDays(monday, 6)),
      places: await listPlaces(tx),
    };
  });

  if (!season) {
    return (
      <Text size="sm" c="dimmed">
        Aucune saison n’est encore paramétrée.
      </Text>
    );
  }
  // Undefined for the current season: its addresses stay as they were.
  const seasonParam = paramOf(season.id, current?.id);
  // The address names the season shown.
  if (moved) redirect(withSeason(`/planning?semaine=${monday}`, seasonParam));
  const isDirector = role === "director";
  const view = vue === "liste" || vue === "type" || vue === "salles" ? vue : "datee";
  const savedId = typeof enregistre === "string" ? enregistre : undefined;
  const confirmed = cours.find((c) => c.id === savedId);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Title order={1} fz="xl">
            Planning {season.label}
          </Title>
          {seasons.length > 1 && (
            <SeasonPicker seasons={seasons} chosen={season.id} current={current?.id ?? season.id} />
          )}
        </div>
        {isDirector && (
          <div className="flex gap-2">
            <ButtonLink href={withSeason("/planning/fermetures", seasonParam)} variant="default">
              Fermetures
            </ButtonLink>
            <ButtonLink href={withSeason("/planning/cours/nouveau", seasonParam)}>Nouveau cours</ButtonLink>
          </div>
        )}
      </div>
      {outside && (
        <Alert role="status" color="yellow">
          Cette semaine n’appartient à aucune saison : le planning affiché reste celui de {season.label}.
        </Alert>
      )}
      {confirmed && <Alert role="status">Cours de {confirmed.discipline} enregistré.</Alert>}
      {supprime && <Alert role="status">Cours supprimé.</Alert>}
      {cours.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun cours pour cette saison.{isDirector && " Créez le premier avec « Nouveau cours »."}
        </Text>
      ) : (
        <ScheduleGrid
          courses={cours}
          editable={isDirector}
          highlighted={confirmed?.id}
          view={view}
          season={seasonParam}
          day={Number(jour)}
          rooms={places.flatMap((s) => s.rooms.map((r) => ({ id: r.id, name: r.name, siteId: s.id, site: s.name })))}
          hours={hours}
          monday={monday}
          today={today}
          lessons={lessons}
          closures={closures}
        />
      )}
    </section>
  );
}
