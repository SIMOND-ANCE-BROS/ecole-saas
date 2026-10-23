import type { Metadata } from "next";
import Link from "next/link";
import { withSchool } from "@/db";
import { listDisciplines, listSeasons } from "@/db/settings";
import { currentSeason } from "@/db/schedule";
import { seasonGrid, readSiblings, listLessonPacks } from "@/db/tariffs";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { LessonPacks, Siblings, Grid } from "./tariffs";

export const metadata: Metadata = { title: "Tarifs et réductions" };

/** `?saison=<id>`: the displayed season, the current season by default. */
export default async function TariffsPage({ searchParams }: PageProps<"/parametres/tarifs">) {
  const { schoolId: schoolId } = await requireRole("direction");
  const { saison: chosen } = await searchParams;
  const donnees = await withSchool(schoolId, async (tx) => {
    const seasons = await listSeasons(tx);
    const current = await currentSeason(tx, todayInParis());
    const season = seasons.find((s) => s.id === chosen) ?? seasons.find((s) => s.id === current?.id) ?? seasons[0];
    if (!season) return null;
    return {
      seasons: seasons,
      season: season,
      grid: await seasonGrid(tx, season.id),
      disciplines: (await listDisciplines(tx)).map((d) => ({ id: d.id, name: d.name })),
      siblings: await readSiblings(tx, season.id),
      lessonPacks: await listLessonPacks(tx, season.id),
    };
  });

  return (
    <section className="flex w-full min-w-0 flex-col gap-5">
      <SettingsHeader
        title="Tarifs et réductions"
        help="Le prix d’une inscription dépend de la durée hebdomadaire cumulée des cours choisis : une ligne par combinaison (« 45 min + 1 h »), éventuellement réservée à une discipline. Les inscriptions déjà faites gardent leur prix."
      />
      {!donnees ? (
        <p className="text-sm">
          Créez d’abord une{" "}
          <Link href="/parametres/saisons" className="lien">
            saison
          </Link>
          .
        </p>
      ) : (
        <>
          <nav aria-label="Saisons" className="flex flex-wrap gap-2 text-sm">
            {donnees.seasons.map((s) => (
              <Link
                key={s.id}
                href={`/parametres/tarifs?saison=${s.id}`}
                aria-current={s.id === donnees.season.id ? "page" : undefined}
                className="rounded-md border border-bordure px-3 py-1 hover:border-accent aria-[current=page]:border-accent aria-[current=page]:bg-accent-doux aria-[current=page]:font-medium"
              >
                {s.label}
              </Link>
            ))}
          </nav>
          <Grid seasonId={donnees.season.id} grid={donnees.grid} disciplines={donnees.disciplines} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Siblings seasonId={donnees.season.id} siblings={donnees.siblings} />
            <LessonPacks seasonId={donnees.season.id} lessonPacks={donnees.lessonPacks} />
          </div>
        </>
      )}
    </section>
  );
}
