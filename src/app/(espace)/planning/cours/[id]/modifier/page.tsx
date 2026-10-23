import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readCourse, scheduleReferential } from "@/db/cours";
import { seasonCourses } from "@/db/planning";
import { requireRole } from "@/lib/session";
import { CourseForm } from "../../formulaire";

export const metadata: Metadata = { title: "Modifier un cours" };

export default async function EditCoursePage({ params }: PageProps<"/planning/cours/[id]/modifier">) {
  const { schoolId: schoolId } = await requireRole("direction");
  const { id } = await params;
  const donnees = await withSchool(schoolId, async (tx) => {
    const course = await readCourse(tx, id);
    if (!course) return null;
    return {
      cours: course,
      referential: await scheduleReferential(tx, course.instructorId),
      schedule: await seasonCourses(tx, course.seasonId),
    };
  });
  if (!donnees) notFound();
  const { cours } = donnees;

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/planning" className="lien">
          Planning
        </Link>
        <span className="text-doux"> / </span>
        <Link href={`/planning/cours/${cours.id}`} className="lien">
          {cours.discipline}
        </Link>
        <span className="text-doux"> / Modifier</span>
      </nav>
      <h1 className="titre-page">Modifier le cours : {cours.discipline}</h1>
      <CourseForm course={cours} referential={donnees.referential} schedule={donnees.schedule} />
    </section>
  );
}
