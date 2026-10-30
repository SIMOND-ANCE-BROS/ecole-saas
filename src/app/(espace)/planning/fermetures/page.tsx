import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { chosenSeason, currentSeason, seasonCourses } from "@/db/schedule";
import { listClosures } from "@/db/lessons";
import { listPlaces } from "@/db/settings";
import { closedCourseLabel } from "@/domain/schedule/closure-scope";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { TextLink } from "../../_ui/text-link";
import { ClosuresManagement } from "./closures";
import { ages } from "../format";
import { seasonParam, withSeason } from "../season-link";

export const metadata: Metadata = { title: "Fermetures" };

export default async function ClosuresPage({ searchParams }: PageProps<"/planning/fermetures">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { saison } = await searchParams;
  const {
    season: season,
    current,
    closures: closures,
    sites,
    courses,
  } = await withSchool(schoolId, async (tx) => {
    const s = await chosenSeason(tx, saison, todayInParis());
    return {
      season: s,
      current: await currentSeason(tx, todayInParis()),
      closures: s ? await listClosures(tx, s.id) : [],
      sites: (await listPlaces(tx)).map((p) => ({ value: p.id, label: p.name })),
      // The season's courses a closure can be limited to (#200).
      // Type, ages and recurrence: to tick them by audience on the closure's dates (#295).
      courses: s
        ? (await seasonCourses(tx, s.id)).map((c) => ({
            value: c.id,
            label: closedCourseLabel(c),
            ages: ages(c.ageMin, c.ageMax),
            type: c.type,
            ageMin: c.ageMin,
            ageMax: c.ageMax,
            recurrence: c.recurrence,
            weekday: c.weekday,
            startDate: c.startDate,
            endDate: c.endDate,
            dates: c.dates,
          }))
        : [],
    };
  });
  const planning = season ? withSeason("/planning", seasonParam(season.id, current?.id)) : "/planning";

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href={planning} size="sm">
          Planning {season?.label}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Fermetures
        </Text>
      </nav>
      <div>
        <Title order={1} fz="xl">
          Fermetures {season?.label}
        </Title>
        <Text size="sm" c="dimmed">
          Vacances, jours fériés, gala : aucun cours n’a lieu ces jours-là, dans toute l’école ou seulement sur certains
          sites ou pour certains cours. Les séances à venir se mettent à jour aussitôt ; une séance dont l’appel est
          fait n’est jamais retirée.
        </Text>
      </div>
      {season ? (
        <ClosuresManagement
          closures={closures}
          seasonStart={season.startDate}
          seasonEnd={season.endDate}
          seasonId={season.id}
          sites={sites}
          courses={courses}
        />
      ) : (
        <Text size="sm">Aucune saison n’est paramétrée.</Text>
      )}
    </section>
  );
}
