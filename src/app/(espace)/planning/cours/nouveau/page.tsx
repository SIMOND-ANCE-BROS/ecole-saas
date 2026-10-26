import type { Metadata } from "next";
import Link from "next/link";
import { withSchool } from "@/db";
import { scheduleReferential } from "@/db/courses";
import { seasonCourses, currentSeason } from "@/db/schedule";
import { seasonCalendar } from "@/db/lessons";
import { todayInParis } from "@/domain/people/age";
import { validDate } from "@/domain/schedule/week";
import { requireRole } from "@/lib/session";
import { CourseForm } from "../course-form";

export const metadata: Metadata = { title: "Nouveau cours" };

export default async function NewCoursePage({ searchParams }: PageProps<"/planning/cours/nouveau">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { jour, heure, duree, date } = await searchParams;
  const {
    season: season,
    referential: referential,
    schedule: schedule,
    calendar,
  } = await withSchool(schoolId, async (tx) => {
    const s = await currentSeason(tx, todayInParis());
    return {
      season: s,
      referential: await scheduleReferential(tx),
      schedule: s ? await seasonCourses(tx, s.id) : [],
      calendar: s ? await seasonCalendar(tx, s.id, todayInParis()) : null,
    };
  });
  if (!season) return <p className="text-sm text-doux">Aucune saison n’est encore paramétrée.</p>;
  const proposedDay = Number(jour);
  const proposedDuration = Number(duree);

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/planning" className="lien">
          Planning {season.label}
        </Link>
        <span className="text-doux"> / Nouveau cours</span>
      </nav>
      <h1 className="titre-page">Nouveau cours</h1>
      <CourseForm
        course={null}
        referential={referential}
        schedule={schedule}
        calendar={calendar}
        day={Number.isInteger(proposedDay) && proposedDay >= 1 && proposedDay <= 7 ? proposedDay : undefined}
        startTime={typeof heure === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(heure) ? heure : undefined}
        date={validDate(date) ?? undefined}
        duration={
          Number.isInteger(proposedDuration) && proposedDuration >= 5 && proposedDuration <= 600
            ? proposedDuration
            : undefined
        }
      />
    </section>
  );
}
