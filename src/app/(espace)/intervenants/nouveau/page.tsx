import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { InstructorForm } from "../formulaire";

export const metadata: Metadata = { title: "Nouvel intervenant" };

export default async function NewInstructorPage() {
  await requireRole("direction");
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/intervenants" className="lien">
          Intervenants
        </Link>
        <span className="text-doux"> / Nouveau</span>
      </nav>
      <h1 className="titre-page">Nouvel intervenant</h1>
      <InstructorForm instructor={null} />
    </section>
  );
}
