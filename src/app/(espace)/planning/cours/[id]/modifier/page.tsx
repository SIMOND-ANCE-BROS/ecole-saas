import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readCourse, scheduleReferential } from "@/db/courses";
import { seasonCourses } from "@/db/schedule";
import { seasonCalendar } from "@/db/lessons";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { CourseForm } from "../../course-form";

export const metadata: Metadata = { title: "Modifier un cours" };

export default async function EditCoursePage({ params }: PageProps<"/planning/cours/[id]/modifier">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { id } = await params;
  const parsed = await withSchool(schoolId, async (tx) => {
    const course = await readCourse(tx, id);
    if (!course) return null;
    return {
      cours: course,
      referential: await scheduleReferential(tx, course.instructorId),
      schedule: await seasonCourses(tx, course.seasonId),
      calendar: await seasonCalendar(tx, course.seasonId, todayInParis()),
    };
  });
  if (!parsed) notFound();
  const { cours } = parsed;

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href={`/planning?saison=${cours.seasonId}`} size="sm">
          Planning
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          /{" "}
        </Text>
        <TextLink href={`/planning/cours/${cours.id}`} size="sm">
          {cours.discipline}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Modifier
        </Text>
      </nav>
      <Title order={1} fz="xl">
        Modifier le cours : {cours.discipline}
      </Title>
      <CourseForm
        course={cours}
        referential={parsed.referential}
        schedule={parsed.schedule}
        calendar={parsed.calendar}
      />
    </section>
  );
}
