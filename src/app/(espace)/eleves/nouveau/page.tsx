import type { Metadata } from "next";
import Link from "next/link";
import { withSchool } from "@/db";
import { readPerson, nomAffiche } from "@/db/people";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { NewStudentGuide } from "./guide";

export const metadata: Metadata = { title: "Nouvel élève" };

/** `?responsable=<id>`: from a contact's record (« Ajouter un enfant »), the guardian is already chosen. */
export default async function NewStudentPage({ searchParams }: PageProps<"/eleves/nouveau">) {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const { responsable } = await searchParams;
  const r = typeof responsable === "string" ? await withSchool(schoolId, (tx) => readPerson(tx, responsable)) : null;
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/eleves" className="lien">
          Élèves
        </Link>
        <span className="text-doux"> / Nouvel élève</span>
      </nav>
      <h1 className="titre-page">Nouvel élève</h1>
      <NewStudentGuide today={todayInParis()} initialGuardian={r ? { id: r.id, name: nomAffiche(r) } : undefined} />
    </section>
  );
}
