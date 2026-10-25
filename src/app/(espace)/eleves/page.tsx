import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { withSchool } from "@/db";
import { seasonCourseLabels, listContacts, listStudents, MAX_RESULTS } from "@/db/students";
import { currentSeason } from "@/db/schedule";
import { readPreference } from "@/db/preferences";
import { displayedName } from "@/db/people";
import { STUDENT_COLUMNS } from "@/domain/filters/columns";
import { readFilter, readSort } from "@/domain/filters/filters";
import { ageAt, todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { ListTable } from "../_filters/list-table";
import { NavigableResults } from "../_people/navigable-results";
import { Telephone } from "../_people/sections";

export const metadata: Metadata = { title: "Élèves" };

/** The school's students; a search also shows the matching contacts (parent, payer). */
export default async function StudentsPage({ searchParams }: PageProps<"/eleves">) {
  const { schoolId: schoolId, userId } = await requireRole("director", "front_desk");
  const { q, f, mode, sort, order } = await searchParams;
  const entry = typeof q === "string" ? q.trim() : "";
  const filter = readFilter(f, mode, STUDENT_COLUMNS);
  const currentSort = readSort(sort, order, STUDENT_COLUMNS);
  const filtering = filter.conditions.length > 0;
  const today = todayInParis();
  const {
    students: students,
    contacts,
    layout: layout,
    courses,
  } = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, today);
    return {
      students: await listStudents(tx, entry, { filter, currentSort, today, seasonId: season?.id }),
      courses: season ? await seasonCourseLabels(tx, season.id) : [],
      contacts: entry ? await listContacts(tx, entry) : [],
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Élèves</h1>
          <p className="text-sm text-doux" aria-live="polite">
            {entry ? `${plural(students.length, "élève")} pour « ${entry} »` : plural(students.length, "élève")}
            {filtering && " avec ces filtres"}
            {students.length >= MAX_RESULTS &&
              ` : seuls les ${MAX_RESULTS} premiers sont affichés, précisez la recherche ou filtrez`}
            {!entry && !filtering && (
              <span className="hidden sm:inline">. Recherche par nom, téléphone, ou nom d’un parent (Ctrl K).</span>
            )}
          </p>
        </div>
        <Link href="/eleves/nouveau" className="bouton-principal">
          Nouvel élève
        </Link>
      </div>

      <NavigableResults>
        {/* useSearchParams requires a Suspense boundary. */}
        <Suspense>
          <ListTable
            list="eleves"
            what="les élèves"
            caption="Élèves"
            columns={STUDENT_COLUMNS}
            layout={layout}
            linkColumn="nom"
            empty={emptyMessage}
            choice={{ cours: courses }}
            emptyAction={
              !entry && (
                <Link href="/eleves/nouveau" className="bouton-principal">
                  Nouvel élève
                </Link>
              )
            }
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
                <p className="text-sm">{emptyMessage}</p>
              ) : (
                <ul className="panneau divide-y divide-bordure">
                  {students.map((e) => (
                    <li key={e.id} className="flex flex-col gap-0.5 px-3 py-2.5 text-sm">
                      <span className="flex items-baseline justify-between gap-2">
                        <Link href={`/eleves/${e.id}`} className="lien text-base font-medium">
                          {[e.firstName, e.name].filter(Boolean).join(" ")}
                        </Link>
                        {e.birthDate && (
                          <span className="shrink-0 tabular-nums text-doux">{ageAt(e.birthDate, today)} ans</span>
                        )}
                      </span>
                      {e.guardians.length > 0 && (
                        <span className="text-doux">Responsable : {e.guardians.join(", ")}</span>
                      )}
                      {e.telephone && (
                        <span className="self-start py-1">
                          <Telephone number={e.telephone} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </Suspense>

        {contacts.length > 0 && (
          <section aria-labelledby="contacts-trouves" className="mt-6 flex flex-col gap-2">
            <h2 id="contacts-trouves" className="text-base font-semibold">
              Contacts pour « {entry} »
            </h2>
            <ul className="panneau divide-y divide-bordure text-sm">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                  <Link href={`/contacts/${c.id}`} data-resultat className="lien font-medium">
                    {displayedName(c)}
                  </Link>
                  {c.students.length > 0 && <span className="text-doux">pour {c.students.join(", ")}</span>}
                  {c.telephone && <span className="ml-auto tabular-nums">{c.telephone}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </NavigableResults>
    </section>
  );
}
