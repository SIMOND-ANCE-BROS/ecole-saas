import type { Metadata } from "next";
import { Suspense } from "react";
import { withSchool } from "@/db";
import { countContacts, listContacts } from "@/db/students";
import { readPreference } from "@/db/preferences";
import { displayedName } from "@/db/people";
import { CONTACT_COLUMNS } from "@/domain/filters/columns";
import { readFilter, readSort } from "@/domain/filters/filters";
import { readPage } from "@/domain/filters/pagination";
import { requireRole } from "@/lib/session";
import { ListTable } from "../_filters/list-table";
import { NavigableResults } from "../_people/navigable-results";
import { ButtonLink } from "../_ui/button-link";
import { RememberList } from "../_ui/list-return";
import { PageHeader } from "../_ui/page-header";

export const metadata: Metadata = { title: "Contacts" };

/** Parents, payers and organisations (CSE, companies). */
export default async function PageContacts({ searchParams }: PageProps<"/contacts">) {
  const { schoolId: schoolId, userId } = await requireRole("director", "front_desk");
  const { q, f, mode, sort, order, page: askedPage } = await searchParams;
  const entry = typeof q === "string" ? q.trim() : "";
  const filter = readFilter(f, mode, CONTACT_COLUMNS);
  const { contacts, total, page, layout } = await withSchool(schoolId, async (tx) => {
    const options = { filter, currentSort: readSort(sort, order, CONTACT_COLUMNS) };
    const total = await countContacts(tx, entry, options);
    const page = readPage(askedPage, total);
    return {
      contacts: await listContacts(tx, entry, { ...options, page }),
      total,
      page,
      layout: await readPreference(tx, userId, "contacts"),
    };
  });

  const filtering = filter.conditions.length > 0;
  const plural = (n: number) => `${n} contact${n > 1 ? "s" : ""}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <Suspense>
        <RememberList list="/contacts" />
      </Suspense>
      <PageHeader
        title="Contacts"
        live
        description={
          <>
            {entry ? `${plural(total)} pour « ${entry} »` : plural(total)}
            {filtering && " avec ces filtres"}
            {!entry && !filtering && (
              <span className="hidden sm:inline">
                . Parents, responsables, payeurs et organismes (CSE, entreprises).
              </span>
            )}
          </>
        }
        actions={<ButtonLink href="/contacts/nouveau">Nouveau contact</ButtonLink>}
      />
      <NavigableResults>
        <Suspense>
          <ListTable
            list="contacts"
            what="des contacts"
            caption="Contacts"
            columns={CONTACT_COLUMNS}
            layout={layout}
            linkColumn="nom"
            empty={
              filtering
                ? "Aucun contact ne correspond à ces filtres."
                : entry
                  ? `Aucun contact ne correspond à « ${entry} ».`
                  : "Aucun contact pour l’instant."
            }
            emptyAction={<ButtonLink href="/contacts/nouveau">Nouveau contact</ButtonLink>}
            pagination={{ page, total }}
            rows={contacts.map((c) => ({
              id: c.id,
              href: `/contacts/${c.id}`,
              badge: c.type === "organisation" ? "organisme" : undefined,
              cells: { nom: displayedName(c), eleves: c.students, telephone: c.telephone, email: c.email },
            }))}
          />
        </Suspense>
      </NavigableResults>
    </section>
  );
}
