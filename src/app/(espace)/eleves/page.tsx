import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { withSchool } from "@/db";
import { seasonCourseLabels, listContacts, listStudents, MAX_RESULTS } from "@/db/eleves";
import { currentSeason } from "@/db/planning";
import { readPreference } from "@/db/preferences";
import { nomAffiche } from "@/db/personnes";
import { STUDENT_COLUMNS } from "@/domaine/filtres/colonnes";
import { readFilter, readSort } from "@/domaine/filtres/filtres";
import { ageAt, todayInParis } from "@/domaine/personnes/age";
import { requireRole } from "@/lib/session";
import { ListTable } from "../_filtres/tableau-liste";
import { NavigableResults } from "../_personnes/resultats";
import { Telephone } from "../_personnes/sections";

export const metadata: Metadata = { title: "Élèves" };

/** Élèves de l'école ; une recherche montre aussi les contacts qui correspondent (parent, payeur). */
export default async function StudentsPage({ searchParams }: PageProps<"/eleves">) {
  const { schoolId: schoolId, userId } = await requireRole("direction", "accueil");
  const { q, f, mode, sort, order } = await searchParams;
  const saisie = typeof q === "string" ? q.trim() : "";
  const filter = readFilter(f, mode, STUDENT_COLUMNS);
  const currentSort = readSort(sort, order, STUDENT_COLUMNS);
  const filtering = filter.conditions.length > 0;
  const today = todayInParis();
  const {
    students: students,
    contacts,
    layout: layout,
    courses: cours,
  } = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, today);
    return {
      students: await listStudents(tx, saisie, { filter, currentSort, today, seasonId: season?.id }),
      courses: season ? await seasonCourseLabels(tx, season.id) : [],
      contacts: saisie ? await listContacts(tx, saisie) : [],
      layout: await readPreference(tx, userId, "eleves"),
    };
  });
  const emptyMessage =
    saisie.length === 1
      ? "Tapez au moins deux caractères."
      : filtering
        ? "Aucun élève ne correspond à ces filtres."
        : saisie
          ? `Aucun élève ne correspond à « ${saisie} ».`
          : "Aucun élève pour l’instant.";
  const plural = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Élèves</h1>
          <p className="text-sm text-doux" aria-live="polite">
            {saisie ? `${plural(students.length, "élève")} pour « ${saisie} »` : plural(students.length, "élève")}
            {filtering && " avec ces filtres"}
            {students.length >= MAX_RESULTS &&
              ` : seuls les ${MAX_RESULTS} premiers sont affichés, précisez la recherche ou filtrez`}
            {!saisie && !filtering && (
              <span className="hidden sm:inline">. Recherche par nom, téléphone, ou nom d’un parent (Ctrl K).</span>
            )}
          </p>
        </div>
        <Link href="/eleves/nouveau" className="bouton-principal">
          Nouvel élève
        </Link>
      </div>

      <NavigableResults>
        {/* useSearchParams exige une frontière Suspense. */}
        <Suspense>
          <ListTable
            list="eleves"
            what="les élèves"
            caption="Élèves"
            columns={STUDENT_COLUMNS}
            layout={layout}
            relationship="nom"
            vide={emptyMessage}
            choice={{ cours }}
            emptyAction={
              !saisie && (
                <Link href="/eleves/nouveau" className="bouton-principal">
                  Nouvel élève
                </Link>
              )
            }
            rows={students.map((e) => ({
              id: e.id,
              href: `/eleves/${e.id}`,
              cellules: {
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
              Contacts pour « {saisie} »
            </h2>
            <ul className="panneau divide-y divide-bordure text-sm">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                  <Link href={`/contacts/${c.id}`} data-resultat className="lien font-medium">
                    {nomAffiche(c)}
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
