import type { Metadata } from "next";
import { Paper, Text, Title } from "@mantine/core";
import { Suspense } from "react";
import { withSchool } from "@/db";
import { countContacts, countStudents, seasonCourseLabels, listContacts, listStudents } from "@/db/students";
import { currentSeason } from "@/db/schedule";
import { readPreference } from "@/db/preferences";
import { displayedName } from "@/db/people";
import { STUDENT_COLUMNS } from "@/domain/filters/columns";
import { readFilter, readSort } from "@/domain/filters/filters";
import { readPage } from "@/domain/filters/pagination";
import { ageAt, todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { ListTable } from "../_filters/list-table";
import { NavigableResults } from "../_people/navigable-results";
import { Telephone } from "../_people/sections";
import { ButtonLink } from "../_ui/button-link";
import { RememberList } from "../_ui/list-return";
import { PageHeader } from "../_ui/page-header";
import { TextLink } from "../_ui/text-link";

export const metadata: Metadata = { title: "Élèves" };

/** Contacts shown under the students during a search: a few, the full list is on « Contacts ». */
const CONTACTS_IN_SEARCH = 20;

/** The school's students; a search also shows the matching contacts (parent, payer). */
export default async function StudentsPage({ searchParams }: PageProps<"/eleves">) {
  const { schoolId: schoolId, userId } = await requireRole("director", "front_desk");
  const { q, f, mode, sort, order, page: askedPage } = await searchParams;
  const entry = typeof q === "string" ? q.trim() : "";
  const filter = readFilter(f, mode, STUDENT_COLUMNS);
  const currentSort = readSort(sort, order, STUDENT_COLUMNS);
  const filtering = filter.conditions.length > 0;
  const today = todayInParis();
  const {
    students: students,
    total,
    page,
    contacts,
    contactCount,
    layout: layout,
    courses,
  } = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, today);
    const options = { filter, currentSort, today, seasonId: season?.id };
    const total = await countStudents(tx, entry, options);
    // Clamped to the pages that exist: a filter may have shrunk the list since `?page=` was set.
    const page = readPage(askedPage, total);
    return {
      students: await listStudents(tx, entry, { ...options, page }),
      total,
      page,
      courses: season ? await seasonCourseLabels(tx, season.id) : [],
      contacts: entry ? await listContacts(tx, entry, { pageSize: CONTACTS_IN_SEARCH }) : [],
      contactCount: entry ? await countContacts(tx, entry) : 0,
      layout: await readPreference(tx, userId, "eleves"),
    };
  });
  const emptyMessage =
    entry.length === 1
      ? "Tapez au moins deux caractères."
      : filtering
        ? "Aucun élève ne correspond à ces filtres."
        : entry
          ? `Aucun élève ne correspond à « ${entry} ».`
          : "Aucun élève pour l’instant.";
  const plural = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <Suspense>
        <RememberList list="/eleves" />
      </Suspense>
      <PageHeader
        title="Élèves"
        live
        description={
          <>
            {entry ? `${plural(total, "élève")} pour « ${entry} »` : plural(total, "élève")}
            {filtering && " avec ces filtres"}
            {!entry && !filtering && (
              <span className="hidden sm:inline">. Recherche par nom, téléphone, ou nom d’un parent (Ctrl K).</span>
            )}
          </>
        }
        actions={<ButtonLink href="/eleves/nouveau">Nouvel élève</ButtonLink>}
      />

      <NavigableResults>
        {/* useSearchParams requires a Suspense boundary. */}
        <Suspense>
          <ListTable
            list="eleves"
            what="des élèves"
            caption="Élèves"
            columns={STUDENT_COLUMNS}
            layout={layout}
            linkColumn="nom"
            empty={emptyMessage}
            choice={{ cours: courses }}
            emptyAction={!entry && <ButtonLink href="/eleves/nouveau">Nouvel élève</ButtonLink>}
            pagination={{ page, total }}
            rows={students.map((e) => ({
              id: e.id,
              href: `/eleves/${e.id}`,
              cells: {
                nom: [e.firstName, e.name].filter(Boolean).join(" "),
                age: e.birthDate ? ageAt(e.birthDate, today) : null,
                responsables: e.guardians,
                facture: e.billedTo,
                telephone: e.telephone,
                naissance: e.birthDate,
                email: e.email,
                cours: e.courses,
                inscription: e.enrollmentStatus,
                prevenir: e.toNotify,
              },
            }))}
            mobile={
              students.length === 0 ? (
                <Text size="sm">{emptyMessage}</Text>
              ) : (
                <Paper withBorder component="ul" className="divide-y divide-bordure">
                  {students.map((e) => (
                    <li key={e.id} className="flex flex-col gap-0.5 px-3 py-2.5 text-sm">
                      <span className="flex items-baseline justify-between gap-2">
                        <TextLink href={`/eleves/${e.id}`} fw={500}>
                          {[e.firstName, e.name].filter(Boolean).join(" ")}
                        </TextLink>
                        {e.birthDate && (
                          <Text span size="sm" c="dimmed" className="shrink-0 tabular-nums">
                            {ageAt(e.birthDate, today)} ans
                          </Text>
                        )}
                      </span>
                      {e.guardians.length > 0 && (
                        <Text span size="sm" c="dimmed">
                          Responsable : {e.guardians.join(", ")}
                        </Text>
                      )}
                      {e.telephone && (
                        <span className="self-start py-1">
                          <Telephone number={e.telephone} />
                        </span>
                      )}
                    </li>
                  ))}
                </Paper>
              )
            }
          />
        </Suspense>

        {contacts.length > 0 && (
          <section aria-labelledby="contacts-trouves" className="mt-6 flex flex-col gap-2">
            <Title order={2} size="h5" id="contacts-trouves">
              Contacts pour « {entry} »
            </Title>
            {contactCount > contacts.length && (
              <Text size="sm" c="dimmed">
                Les {contacts.length} premiers sur {contactCount} :{" "}
                <TextLink href={`/contacts?q=${encodeURIComponent(entry)}`} size="sm" inherit>
                  voir tous les contacts pour « {entry} »
                </TextLink>
                .
              </Text>
            )}
            <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                  <TextLink href={`/contacts/${c.id}`} data-resultat size="sm" fw={500}>
                    {displayedName(c)}
                  </TextLink>
                  {c.students.length > 0 && (
                    <Text span size="sm" c="dimmed">
                      pour {c.students.join(", ")}
                    </Text>
                  )}
                  {c.telephone && <span className="ml-auto tabular-nums">{c.telephone}</span>}
                </li>
              ))}
            </Paper>
          </section>
        )}
      </NavigableResults>
    </section>
  );
}
