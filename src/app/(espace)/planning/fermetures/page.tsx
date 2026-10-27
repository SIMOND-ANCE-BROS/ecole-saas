import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { chosenSeason, currentSeason } from "@/db/schedule";
import { listClosures } from "@/db/lessons";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { TextLink } from "../../_ui/text-link";
import { ClosuresManagement } from "./closures";
import { seasonParam, withSeason } from "../season-link";

export const metadata: Metadata = { title: "Fermetures" };

export default async function ClosuresPage({ searchParams }: PageProps<"/planning/fermetures">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { saison } = await searchParams;
  const {
    season: season,
    current,
    closures: closures,
  } = await withSchool(schoolId, async (tx) => {
    const s = await chosenSeason(tx, saison, todayInParis());
    return {
      season: s,
      current: await currentSeason(tx, todayInParis()),
      closures: s ? await listClosures(tx, s.id) : [],
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
          Vacances, jours fériés, gala : aucun cours n’a lieu ces jours-là. Les séances à venir se mettent à jour
          aussitôt ; une séance dont l’appel est fait n’est jamais retirée.
        </Text>
      </div>
      {season ? (
        <ClosuresManagement
          closures={closures}
          seasonStart={season.startDate}
          seasonEnd={season.endDate}
          seasonId={season.id}
        />
      ) : (
        <Text size="sm">Aucune saison n’est paramétrée.</Text>
      )}
    </section>
  );
}
