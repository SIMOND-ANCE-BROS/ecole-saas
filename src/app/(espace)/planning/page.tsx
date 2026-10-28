import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, Text } from "@mantine/core";
import { withSchool } from "@/db";
import { hoursBySite, listPlaces } from "@/db/settings";
import { courseCountBySeason } from "@/db/season-copy";
import { chosenSeason, currentSeason, schoolSeasons, seasonCourses, seasonOverlapping } from "@/db/schedule";
import { closuresBetween, weekLessons } from "@/db/lessons";
import { addDays, validDate, mondayOf } from "@/domain/schedule/week";
import { todayInParis } from "@/domain/people/age";
import { shownSeason } from "@/domain/schedule/shown-season";
import { schoolContext } from "@/lib/session";
import { ButtonLink } from "../_ui/button-link";
import { PageHeader } from "../_ui/page-header";
import { TextLink } from "../_ui/text-link";
import { ScheduleGrid } from "./grid";
import { copiedCount, copyLink, seasonParam as paramOf, withSeason } from "./season-link";
import { SeasonPicker } from "./season-picker";

export const metadata: Metadata = { title: "Planning" };

export default async function SchedulePage({ searchParams }: PageProps<"/planning">) {
  const { schoolId: schoolId, role } = await schoolContext();
  const { enregistre, supprime, copie, vue, semaine, jour, saison } = await searchParams;
  const today = todayInParis();
  const {
    season: season,
    moved,
    outside,
    current,
    seasons,
    courseCounts,
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
    // A week of another season shows that season; a week in no season keeps the chosen one.
    const overlapping = week ? await seasonOverlapping(tx, monday, addDays(monday, 6)) : null;
    const { season: s, moved, outside } = shownSeason(asked, week ? monday : null, overlapping);
    return {
      season: s,
      moved,
      outside,
      current: await currentSeason(tx, today),
      seasons: await schoolSeasons(tx),
      courseCounts: await courseCountBySeason(tx),
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
  if (moved) {
    const kept = new URLSearchParams({ semaine: monday });
    if (typeof vue === "string") kept.set("vue", vue);
    if (typeof jour === "string") kept.set("jour", jour);
    redirect(withSeason(`/planning?${kept}`, seasonParam));
  }
  const isDirector = role === "director";
  const view = vue === "liste" || vue === "type" || vue === "salles" ? vue : "datee";
  const savedId = typeof enregistre === "string" ? enregistre : undefined;
  const confirmed = cours.find((c) => c.id === savedId);
  const copied = copiedCount(copie, cours.length);
  const copy = copyLink(season, seasons, courseCounts, current?.id);

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={`Planning ${season.label}`}
        beside={
          seasons.length > 1 && <SeasonPicker seasons={seasons} chosen={season.id} current={current?.id ?? season.id} />
        }
        actions={
          isDirector && (
            <>
              {seasons.length > 1 && (
                <ButtonLink href={copy.href} variant="default">
                  {copy.label}
                </ButtonLink>
              )}
              <ButtonLink href={withSeason("/planning/fermetures", seasonParam)} variant="default">
                Fermetures
              </ButtonLink>
              <ButtonLink href={withSeason("/planning/cours/nouveau", seasonParam)}>Nouveau cours</ButtonLink>
            </>
          )
        }
      />
      {outside && (
        <Alert role="status" color="yellow">
          Cette semaine n’appartient à aucune saison : le planning affiché reste celui de {season.label}.
        </Alert>
      )}
      {confirmed && <Alert role="status">Cours de {confirmed.discipline} enregistré.</Alert>}
      {supprime && <Alert role="status">Cours supprimé.</Alert>}
      {copied > 0 && (
        <Alert role="status">
          {copied === 1 ? "1 cours copié" : `${copied} cours copiés`}, avec leurs séances. Modifiez maintenant ce qui
          change pour cette saison.
        </Alert>
      )}
      {cours.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun cours pour cette saison.
          {isDirector &&
            (seasons.length > 1 ? (
              <>
                {" "}
                Créez le premier avec « Nouveau cours », ou{" "}
                <TextLink href={copy.href} size="sm" inherit>
                  reprenez les cours d’une autre saison
                </TextLink>
                .
              </>
            ) : (
              " Créez le premier avec « Nouveau cours »."
            ))}
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
          seasonPeriod={{ start: season.startDate, end: season.endDate }}
          lessons={lessons}
          closures={closures}
        />
      )}
    </section>
  );
}
