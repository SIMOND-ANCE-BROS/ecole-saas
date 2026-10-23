import type { Metadata } from "next";
import Link from "next/link";
import { withSchool } from "@/db";
import { hoursBySite } from "@/db/settings";
import { seasonCourses, currentSeason } from "@/db/schedule";
import { closuresBetween, weekLessons } from "@/db/lessons";
import { addDays, validDate, mondayOf } from "@/domain/schedule/week";
import { todayInParis } from "@/domain/people/age";
import { schoolContext } from "@/lib/session";
import { ScheduleGrid } from "./grid";

export const metadata: Metadata = { title: "Planning" };

export default async function SchedulePage({ searchParams }: PageProps<"/planning">) {
  const { schoolId: schoolId, role } = await schoolContext();
  const { enregistre, supprime, vue, semaine } = await searchParams;
  const today = todayInParis();
  const monday = mondayOf(validDate(semaine) ?? today);
  const {
    season: season,
    courses: cours,
    hours: hours,
    lessons: lessons,
    closures: closures,
  } = await withSchool(schoolId, async (tx) => {
    const s = await currentSeason(tx, today);
    return {
      season: s,
      courses: s ? await seasonCourses(tx, s.id) : [],
      hours: await hoursBySite(tx),
      lessons: await weekLessons(tx, monday),
      closures: await closuresBetween(tx, monday, addDays(monday, 6)),
    };
  });

  if (!season) {
    return <p className="text-sm text-doux">Aucune saison n’est encore paramétrée.</p>;
  }
  const isDirector = role === "director";
  const savedId = typeof enregistre === "string" ? enregistre : undefined;
  const confirmed = cours.find((c) => c.id === savedId);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="titre-page">Planning {season.label}</h1>
        {isDirector && (
          <div className="flex gap-2">
            <Link href="/planning/fermetures" className="bouton-secondaire">
              Fermetures
            </Link>
            <Link href="/planning/cours/nouveau" className="bouton-principal">
              Nouveau cours
            </Link>
          </div>
        )}
      </div>
      {confirmed && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          Cours de {confirmed.discipline} enregistré.
        </p>
      )}
      {supprime && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          Cours supprimé.
        </p>
      )}
      {cours.length === 0 ? (
        <p className="text-sm text-doux">
          Aucun cours pour cette saison.{isDirector && " Créez le premier avec « Nouveau cours »."}
        </p>
      ) : (
        <ScheduleGrid
          courses={cours}
          editable={isDirector}
          highlighted={confirmed?.id}
          view={vue === "liste" ? "liste" : vue === "type" ? "type" : "datee"}
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
