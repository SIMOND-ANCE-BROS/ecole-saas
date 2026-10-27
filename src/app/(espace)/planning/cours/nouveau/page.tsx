import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { scheduleReferential } from "@/db/courses";
import { seasonCourses, currentSeason } from "@/db/schedule";
import { seasonCalendar } from "@/db/lessons";
import { todayInParis } from "@/domain/people/age";
import { validDate } from "@/domain/schedule/week";
import { requireRole } from "@/lib/session";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { CourseForm } from "../course-form";

export const metadata: Metadata = { title: "Nouveau cours" };

export default async function NewCoursePage({ searchParams }: PageProps<"/planning/cours/nouveau">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { jour, heure, duree, date, salle } = await searchParams;
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
  if (!season)
    return (
      <Text size="sm" c="dimmed">
        Aucune saison n’est encore paramétrée.
      </Text>
    );
  const proposedDay = Number(jour);
  const proposedDuration = Number(duree);

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href="/planning" size="sm">
          Planning {season.label}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Nouveau cours
        </Text>
      </nav>
      <Title order={1} fz="xl">
        Nouveau cours
      </Title>
      <CourseForm
        course={null}
        referential={referential}
        schedule={schedule}
        calendar={calendar}
        day={Number.isInteger(proposedDay) && proposedDay >= 1 && proposedDay <= 7 ? proposedDay : undefined}
        startTime={typeof heure === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(heure) ? heure : undefined}
        date={validDate(date) ?? undefined}
        room={typeof salle === "string" ? salle : undefined}
        duration={
          Number.isInteger(proposedDuration) && proposedDuration >= 5 && proposedDuration <= 600
            ? proposedDuration
            : undefined
        }
      />
    </section>
  );
}
