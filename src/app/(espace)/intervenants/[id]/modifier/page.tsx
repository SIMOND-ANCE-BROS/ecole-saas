import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readInstructor } from "@/db/instructors";
import { requireRole } from "@/lib/session";
import { InstructorForm } from "../../instructor-form";

export const metadata: Metadata = { title: "Modifier un intervenant" };

export default async function UpdateInstructor({ params }: PageProps<"/intervenants/[id]/modifier">) {
  const { schoolId: schoolId } = await requireRole("direction");
  const { id } = await params;
  const instructor = await withSchool(schoolId, (tx) => readInstructor(tx, id));
  if (!instructor) notFound();
  const name = `${instructor.firstName} ${instructor.name}`;
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link className="lien" href="/intervenants">
          Intervenants
        </Link>
        <span> / </span>
        <Link className="lien" href={`/intervenants/${id}`}>
          {name}
        </Link>
        <span className="text-doux"> / Modifier</span>
      </nav>
      <h1 className="titre-page">Modifier {name}</h1>
      <InstructorForm instructor={instructor} />
    </section>
  );
}
