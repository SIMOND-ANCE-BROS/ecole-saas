import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readPerson, nomAffiche } from "@/db/people";
import { requireRole } from "@/lib/session";
import { PersonForm } from "../../../_people/person-form";

export const metadata: Metadata = { title: "Modifier un contact" };

export default async function EditContactPage({ params }: PageProps<"/contacts/[id]/modifier">) {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const { id } = await params;
  const record = await withSchool(schoolId, (tx) => readPerson(tx, id));
  if (!record) notFound();
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/contacts" className="lien">
          Contacts
        </Link>
        <span className="text-doux"> / </span>
        <Link href={`/contacts/${record.id}`} className="lien">
          {nomAffiche(record)}
        </Link>
        <span className="text-doux"> / Modifier</span>
      </nav>
      <h1 className="titre-page">Modifier {nomAffiche(record)}</h1>
      <PersonForm person={record} section="contacts" />
    </section>
  );
}
