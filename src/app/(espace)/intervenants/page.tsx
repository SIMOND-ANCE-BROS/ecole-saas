import type { Metadata } from "next";
import { Alert, Text, Title } from "@mantine/core";
import { Suspense } from "react";
import { withSchool } from "@/db";
import { listInstructors, PAY_MODES, STATUSES } from "@/db/instructors";
import { readPreference } from "@/db/preferences";
import { currentSeason } from "@/db/schedule";
import { type ColumnId, INSTRUCTOR_COLUMNS } from "@/domain/filters/columns";
import { applyFilter, type Cell, readFilter, readSort, normalizeText, sortRows } from "@/domain/filters/filters";
import { todayInParis } from "@/domain/people/age";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { ListTable } from "../_filters/list-table";
import { ButtonLink } from "../_ui/button-link";

export const metadata: Metadata = { title: "Intervenants" };

export default async function InstructorsPage({ searchParams }: PageProps<"/intervenants">) {
  const { schoolId: schoolId, role, userId } = await requireRole("director", "front_desk");
  const { enregistre, f, mode, sort, order, q } = await searchParams;
  const entry = typeof q === "string" ? normalizeText(q) : "";
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
  const isDirector = role === "director";
  // The instructors' rate is shown to management only.
  const columns = isDirector ? INSTRUCTOR_COLUMNS : INSTRUCTOR_COLUMNS.filter((c) => c.id !== "tarif");
  // Full list already loaded (a few instructors): in-memory filtering, same rules as in SQL.
  const filter = readFilter(f, mode, INSTRUCTOR_COLUMNS);
  const values: Partial<Record<ColumnId<typeof INSTRUCTOR_COLUMNS>, (i: (typeof instructors)[number]) => Cell>> = {
    nom: (i) => `${i.firstName} ${i.name}`,
    statut: (i) => STATUSES[i.status],
    cours: (i) => i.seasonCourses,
    email: (i) => i.email,
  };
  const visible = sortRows(
    applyFilter(
      // Top search bar (Ctrl K): name or e-mail.
      instructors.filter((i) => !entry || normalizeText(`${i.firstName} ${i.name} ${i.email ?? ""}`).includes(entry)),
      filter,
      columns.map((c) => ({ ...c, value: values[c.id] ?? (() => null) })),
    ),
    readSort(sort, order, columns),
    (i, column) => {
      const c = INSTRUCTOR_COLUMNS.find((d) => d.id === column);
      return c && values[c.id]?.(i);
    },
  );
  const confirmed = instructors.find((i) => i.id === enregistre);

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Title order={1} fz="xl">
            Intervenants
          </Title>
          <Text size="sm" c="dimmed">
            {instructors.filter((i) => i.active).length} actif
            {instructors.filter((i) => i.active).length > 1 ? "s" : ""}
            {season && `, cours de la saison ${season.label}`}
          </Text>
        </div>
        {isDirector && <ButtonLink href="/intervenants/nouveau">Ajouter un intervenant</ButtonLink>}
      </div>

      {confirmed && (
        <Alert role="status">
          {confirmed.firstName} {confirmed.name} enregistré.
        </Alert>
      )}

      {instructors.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun intervenant pour l’instant.{isDirector && " Ajoutez les professeurs avant de construire le planning."}
        </Text>
      ) : (
        <Suspense>
          <ListTable
            list="intervenants"
            what="des intervenants"
            caption="Intervenants"
            columns={columns}
            layout={layout}
            linkColumn="nom"
            empty={
              entry
                ? "Aucun intervenant ne correspond à cette recherche."
                : "Aucun intervenant ne correspond à ces filtres."
            }
            choice={{ statut: Object.values(STATUSES) }}
            rows={visible.map((i) => ({
              id: i.id,
              href: isDirector ? `/intervenants/${i.id}` : undefined,
              dimmed: !i.active,
              badge: i.active ? undefined : "inactif",
              cells: {
                nom: `${i.firstName} ${i.name}`,
                statut: STATUSES[i.status],
                cours: i.seasonCourses,
                // Never sent to the front desk's browser: hiding the column is not enough.
                tarif: isDirector ? `${formatEuros(i.rateCents)} ${PAY_MODES[i.payMode]}` : null,
                email: i.email,
              },
            }))}
          />
        </Suspense>
      )}
    </section>
  );
}
