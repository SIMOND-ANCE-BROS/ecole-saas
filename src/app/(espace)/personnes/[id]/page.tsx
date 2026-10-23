import { notFound, redirect } from "next/navigation";
import { withSchool } from "@/db";
import { isStudent } from "@/db/students";
import { requireRole } from "@/lib/session";

/** Ancienne adresse d'une personne : renvoie vers sa fiche élève ou contact. */
export default async function OldPerson({ params }: PageProps<"/personnes/[id]">) {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const { id } = await params;
  const student = await withSchool(schoolId, (tx) => isStudent(tx, id));
  if (student === null) notFound();
  redirect(student ? `/eleves/${id}` : `/contacts/${id}`);
}
