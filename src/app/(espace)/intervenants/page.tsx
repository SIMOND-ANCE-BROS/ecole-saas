import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { withSchool } from "@/db";
import { listInstructors, PAY_MODES, STATUSES } from "@/db/intervenants";
import { readPreference } from "@/db/preferences";
import { currentSeason } from "@/db/planning";
import { INSTRUCTOR_COLUMNS } from "@/domaine/filtres/colonnes";
import { applyFilter, type Cellule, readFilter, readSort, normalizeText, sortRows } from "@/domaine/filtres/filtres";
import { todayInParis } from "@/domaine/personnes/age";
import { formatEuros } from "@/lib/montant";
import { requireRole } from "@/lib/session";
import { ListTable } from "../_filtres/tableau-liste";

export const metadata: Metadata = { title: "Intervenants" };

export default async function InstructorsPage({ searchParams }: PageProps<"/intervenants">) {
  const { schoolId: schoolId, role, userId } = await requireRole("direction", "accueil");
  const { enregistre, f, mode, sort, order, q } = await searchParams;
  const saisie = typeof q === "string" ? normalizeText(q) : "";
  const {
    season: season,
    instructors: instructors,
    layout: layout,
  } = await withSchool(schoolId, async (tx) => {
    const s = await currentSeason(tx, todayInParis());
    return {
      season: s,
      instructors: s ? await listInstructors(tx, s.id) : [],
      layout: await readPreference(tx, userId, "intervenants"),
    };
  });
  const direction = role === "direction";
  // Le tarif des intervenants n'est montré qu'à la direction.
  const columns = direction ? INSTRUCTOR_COLUMNS : INSTRUCTOR_COLUMNS.filter((c) => c.id !== "tarif");
  // Liste complète déjà chargée (quelques intervenants) : filtrage en mémoire, mêmes règles qu'en SQL.
  const filter = readFilter(f, mode, INSTRUCTOR_COLUMNS);
  const values: Record<string, (i: (typeof instructors)[number]) => Cellule> = {
    nom: (i) => `${i.firstName} ${i.name}`,
    statut: (i) => STATUSES[i.status],
    cours: (i) => i.seasonCourses,
    email: (i) => i.email,
  };
  const visible = sortRows(
    applyFilter(
      // Recherche du haut (Ctrl K) : nom ou e-mail.
      instructors.filter((i) => !saisie || normalizeText(`${i.firstName} ${i.name} ${i.email ?? ""}`).includes(saisie)),
      filter,
      columns.map((c) => ({ ...c, value: values[c.id] ?? (() => null) })),
    ),
    readSort(sort, order, columns),
    (i, column) => values[column]?.(i),
  );
  const confirmed = instructors.find((i) => i.id === enregistre);

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Intervenants</h1>
          <p className="text-sm text-doux">
            {instructors.filter((i) => i.active).length} actif
            {instructors.filter((i) => i.active).length > 1 ? "s" : ""}
            {season && `, cours de la saison ${season.label}`}
          </p>
        </div>
        {direction && (
          <Link href="/intervenants/nouveau" className="bouton-principal">
            Ajouter un intervenant
          </Link>
        )}
      </div>

      {confirmed && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          {confirmed.firstName} {confirmed.name} enregistré.
        </p>
      )}

      {instructors.length === 0 ? (
        <p className="text-sm text-doux">
          Aucun intervenant pour l’instant.{direction && " Ajoutez les professeurs avant de construire le planning."}
        </p>
      ) : (
        <Suspense>
          <ListTable
            list="intervenants"
            what="les intervenants"
            caption="Intervenants"
            columns={columns}
            layout={layout}
            relationship="nom"
            vide={
              saisie
                ? "Aucun intervenant ne correspond à cette recherche."
                : "Aucun intervenant ne correspond à ces filtres."
            }
            choice={{ statut: Object.values(STATUSES) }}
            rows={visible.map((i) => ({
              id: i.id,
              href: direction ? `/intervenants/${i.id}` : undefined,
              dimmed: !i.active,
              badge: i.active ? undefined : "inactif",
              cellules: {
                nom: `${i.firstName} ${i.name}`,
                statut: STATUSES[i.status],
                cours: i.seasonCourses,
                // Jamais envoyé au navigateur de l'accueil : masquer la colonne ne suffit pas.
                ...(direction ? { tarif: `${formatEuros(i.rateCents)} ${PAY_MODES[i.payMode]}` } : {}),
                email: i.email,
              },
            }))}
          />
        </Suspense>
      )}
    </section>
  );
}
