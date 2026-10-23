import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { PersonForm } from "../../_people/person-form";

export const metadata: Metadata = { title: "Nouveau contact" };

export default async function NewContactPage() {
  await requireRole("direction", "accueil");
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/contacts" className="lien">
          Contacts
        </Link>
        <span className="text-doux"> / Nouveau contact</span>
      </nav>
      <h1 className="titre-page">Nouveau contact</h1>
      <p className="text-sm text-doux">
        Pour un élève et son parent, utilisez plutôt{" "}
        <Link href="/eleves/nouveau" className="lien">
          « Nouvel élève »
        </Link>{" "}
        : le parent y est créé dans la foulée.
      </p>
      <PersonForm person={null} section="contacts" />
    </section>
  );
}
