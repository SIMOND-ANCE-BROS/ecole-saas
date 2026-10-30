import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { entityChoices } from "@/db/billing-entities";
import { courseVat } from "@/db/vat-treatments";
import { coursePay, scheduleReferential } from "@/db/courses";
import { chosenSeason, currentSeason, seasonCourses } from "@/db/schedule";
import { seasonCalendar } from "@/db/lessons";
import { todayInParis } from "@/domain/people/age";
import { validDate } from "@/domain/schedule/week";
import { requireRole } from "@/lib/session";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { CourseForm } from "../course-form";
import { newCourseTitle, seasonParam, withSeason } from "../../season-link";
import { FormPage } from "@/app/(espace)/_ui/form-page";

export const metadata: Metadata = { title: "Nouveau cours" };

export default async function NewCoursePage({ searchParams }: PageProps<"/planning/cours/nouveau">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { jour, heure, duree, date, salle, saison } = await searchParams;
  const {
    season: season,
    current,
    referential: referential,
    entities,
    vat,
    pay,
    schedule: schedule,
    calendar,
  } = await withSchool(schoolId, async (tx) => {
    const s = await chosenSeason(tx, saison, todayInParis());
    return {
      season: s,
      current: await currentSeason(tx, todayInParis()),
      referential: await scheduleReferential(tx),
      entities: await entityChoices(tx),
      vat: await courseVat(tx),
      pay: await coursePay(tx, null),
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
  const planning = withSeason("/planning", seasonParam(season.id, current?.id));
  const proposedDay = Number(jour);
  const proposedDuration = Number(duree);

  return (
    <FormPage className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href={planning} size="sm">
          Planning {season.label}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Nouveau cours
        </Text>
      </nav>
      <Title order={1} fz="xl">
        {newCourseTitle(season.label, season.id === current?.id)}
      </Title>
      <CourseForm
        course={null}
        seasonId={season.id}
        planning={planning}
        referential={referential}
        entities={entities}
        vat={vat}
        pay={pay}
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
    </FormPage>
  );
}
