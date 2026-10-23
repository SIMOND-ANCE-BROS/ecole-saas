import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { withSchool } from "@/db";
import { listContacts } from "@/db/students";
import { readPreference } from "@/db/preferences";
import { nomAffiche } from "@/db/people";
import { CONTACT_COLUMNS } from "@/domain/filters/columns";
import { readFilter, readSort } from "@/domain/filters/filters";
import { requireRole } from "@/lib/session";
import { ListTable } from "../_filters/list-table";
import { NavigableResults } from "../_people/navigable-results";

export const metadata: Metadata = { title: "Contacts" };

/** Parents, payers and organisations (CSE, companies). */
export default async function PageContacts({ searchParams }: PageProps<"/contacts">) {
  const { schoolId: schoolId, userId } = await requireRole("direction", "accueil");
  const { q, f, mode, sort, order } = await searchParams;
  const saisie = typeof q === "string" ? q.trim() : "";
  const filter = readFilter(f, mode, CONTACT_COLUMNS);
  const { contacts, layout: layout } = await withSchool(schoolId, async (tx) => ({
    contacts: await listContacts(tx, saisie, { filter, currentSort: readSort(sort, order, CONTACT_COLUMNS) }),
    layout: await readPreference(tx, userId, "contacts"),
  }));

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Contacts</h1>
          <p className="text-sm text-doux">Parents, responsables, payeurs et organismes (CSE, entreprises).</p>
        </div>
        <Link href="/contacts/nouveau" className="bouton-principal">
          Nouveau contact
        </Link>
      </div>
      <NavigableResults>
        <Suspense>
          <ListTable
            list="contacts"
            what="les contacts"
            caption="Contacts"
            columns={CONTACT_COLUMNS}
            layout={layout}
            relationship="nom"
            vide={
              filter.conditions.length > 0
                ? "Aucun contact ne correspond à ces filtres."
                : saisie
                  ? `Aucun contact ne correspond à « ${saisie} ».`
                  : "Aucun contact pour l’instant."
            }
            emptyAction={
              <Link href="/contacts/nouveau" className="bouton-principal">
                Nouveau contact
              </Link>
            }
            rows={contacts.map((c) => ({
              id: c.id,
              href: `/contacts/${c.id}`,
              badge: c.type === "professionnel" ? "organisme" : undefined,
              cellules: { nom: nomAffiche(c), eleves: c.students, telephone: c.telephone, email: c.email },
            }))}
          />
        </Suspense>
      </NavigableResults>
    </section>
  );
}
