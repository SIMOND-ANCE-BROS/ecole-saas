import type { Metadata } from "next";
import { Paper, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from "@mantine/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { calendarState } from "@/db/calendar-feed";
import { PROVIDER_NAME } from "@/connectors/calendar/oauth";
import { connectionState } from "@/db/calendar-connections";
import { listUnavailabilities } from "@/db/unavailabilities";
import { readInstructor, PAY_MODES, VAT_REGIMES, STATUSES, PAY_UNITS } from "@/db/instructors";
import { coursesWithOwnRate } from "@/db/courses";
import { DAY_NAMES } from "@/domain/schedule/days";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { CalendarSubscription } from "./calendar-subscription";
import { Unavailabilities } from "./unavailabilities";

export const metadata: Metadata = { title: "Intervenant" };

export default async function InstructorPage({ params }: PageProps<"/intervenants/[id]">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { id } = await params;
  const parsed = await withSchool(schoolId, async (tx) => {
    const i = await readInstructor(tx, id);
    return i
      ? {
          instructor: i,
          calendar: await calendarState(tx, i.id),
          connection: await connectionState(tx, i.id),
          unavailabilities: await listUnavailabilities(tx, i.id, new Date()),
          ownRates: await coursesWithOwnRate(tx, i.id),
        }
      : null;
  });
  if (!parsed) notFound();
  const {
    instructor: instructor,
    calendar: calendar,
    connection: connection,
    unavailabilities: unavailabilities,
    ownRates,
  } = parsed;

  const name = `${instructor.firstName} ${instructor.name}`;
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/intervenants" className="lien">
          Intervenants
        </Link>
        <span className="text-doux"> / {name}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="titre-page">{name}</h1>
          <p className="text-sm text-doux">
            {instructor.active ? "Actif" : "Inactif"}
            {instructor.isOwner && ", dirigeant de l’école"}
          </p>
        </div>
        <Link href={`/intervenants/${id}/modifier`} className="bouton-secondaire">
          Modifier la fiche
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panneau p-4" aria-labelledby="identite">
          <h2 id="identite" className="mb-3 font-semibold">
            Coordonnées et statut
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
            <dt className="text-doux">E-mail</dt>
            <dd className="break-all">
              {instructor.email ? (
                <a className="lien" href={`mailto:${instructor.email}`}>
                  {instructor.email}
                </a>
              ) : (
                "Non renseigné"
              )}
            </dd>
            <dt className="text-doux">Statut</dt>
            <dd>{STATUSES[instructor.status]}</dd>
            {instructor.status !== "employee" && (
              <>
                <dt className="text-doux">SIREN</dt>
                <dd>{instructor.siren || "Non renseigné"}</dd>
              </>
            )}
            <dt className="text-doux">TVA</dt>
            <dd>{VAT_REGIMES[instructor.vatRegime]}</dd>
          </dl>
        </section>
        <section className="panneau p-4" aria-labelledby="remuneration">
          <h2 id="remuneration" className="mb-3 font-semibold">
            Rémunération
          </h2>
          <p className="text-sm">{PAY_MODES[instructor.payMode]}</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">
            {formatEuros(instructor.rateCents)}{" "}
            <span className="text-sm font-normal text-doux">/ {PAY_UNITS[instructor.payMode]}</span>
          </p>
          <p className="mt-2 text-xs text-doux">Tarif de référence. Ce montant n’est pas un relevé à payer.</p>
        </section>
      </div>
      {ownRates.length > 0 && (
        <Paper withBorder p="md" component="section" aria-labelledby="tarifs-cours">
          <Title order={2} size="h5" id="tarifs-cours" mb="xs">
            Cours à un autre tarif
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            Pour ces cours, ce tarif remplace le tarif habituel de {instructor.firstName}.
          </Text>
          <div className="overflow-x-auto">
            <Table>
              <TableThead>
                <TableTr>
                  <TableTh>Cours</TableTh>
                  <TableTh>Créneau</TableTh>
                  <TableTh>Saison</TableTh>
                  <TableTh ta="right">Tarif</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {ownRates.map((c) => (
                  <TableTr key={c.id}>
                    <TableTd>
                      <TextLink href={`/planning/cours/${c.id}`} size="sm">
                        {c.discipline}
                        {c.level ? ` ${c.level}` : ""}
                      </TextLink>
                    </TableTd>
                    <TableTd>{c.weekday ? `${DAY_NAMES[c.weekday]} ${c.startTime}` : "À des dates précises"}</TableTd>
                    <TableTd>{c.season}</TableTd>
                    <TableTd ta="right" className="whitespace-nowrap tabular-nums">
                      {formatEuros(c.rateCents)} / {PAY_UNITS[instructor.payMode]}
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </div>
        </Paper>
      )}
      <Unavailabilities
        instructorId={instructor.id}
        firstName={instructor.firstName}
        unavailabilities={unavailabilities.map((i) => ({
          ...i,
          start: i.start.toISOString(),
          end: i.end.toISOString(),
        }))}
      />
      <CalendarSubscription
        instructorId={instructor.id}
        firstName={instructor.firstName}
        activeSince={calendar?.toISOString() ?? null}
        connection={
          connection
            ? {
                provider: PROVIDER_NAME[connection.provider],
                account: connection.account,
                lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
                error: connection.error,
              }
            : null
        }
      />
    </section>
  );
}
