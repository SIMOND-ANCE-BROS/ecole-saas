import type { Metadata } from "next";
import { Anchor, Paper, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { calendarState } from "@/db/calendar-feed";
import { PROVIDER_NAME } from "@/connectors/calendar/oauth";
import { connectionState } from "@/db/calendar-connections";
import { listUnavailabilities } from "@/db/unavailabilities";
import { readInstructor, PAY_MODES, VAT_REGIMES, STATUSES, PAY_UNITS } from "@/db/instructors";
import { coursesWithOwnRate } from "@/db/courses";
import { DAY_NAMES } from "@/domain/schedule/days";
import { ButtonLink } from "@/app/(espace)/_ui/button-link";
import { BackToList } from "@/app/(espace)/_ui/list-return";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { end } from "@/app/(espace)/planning/format";
import { courseRateAllowed, rateInCurrentUnit } from "@/domain/payroll/rate";
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
        <BackToList list="/intervenants" size="sm">
          Intervenants
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" "}
          / {name}
        </Text>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Title order={1} fz="xl">
            {name}
          </Title>
          <Text size="sm" c="dimmed">
            {instructor.active ? "Actif" : "Inactif"}
            {instructor.isOwner && ", dirigeant de l’école"}
          </Text>
        </div>
        <ButtonLink href={`/intervenants/${id}/modifier`} variant="default">
          Modifier la fiche
        </ButtonLink>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Paper withBorder p="md" component="section" aria-labelledby="identite">
          <Title order={2} size="h5" id="identite" mb="sm">
            Coordonnées et statut
          </Title>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
            <Text component="dt" size="sm" c="dimmed">
              E-mail
            </Text>
            <dd className="break-all">
              {instructor.email ? (
                <Anchor href={`mailto:${instructor.email}`} size="sm">
                  {instructor.email}
                </Anchor>
              ) : (
                "Non renseigné"
              )}
            </dd>
            <Text component="dt" size="sm" c="dimmed">
              Statut
            </Text>
            <dd>{STATUSES[instructor.status]}</dd>
            {instructor.status !== "employee" && (
              <>
                <Text component="dt" size="sm" c="dimmed">
                  SIREN
                </Text>
                <dd>{instructor.siren || "Non renseigné"}</dd>
              </>
            )}
            <Text component="dt" size="sm" c="dimmed">
              TVA
            </Text>
            <dd>{VAT_REGIMES[instructor.vatRegime]}</dd>
          </dl>
        </Paper>
        <Paper withBorder p="md" component="section" aria-labelledby="remuneration">
          <Title order={2} size="h5" id="remuneration" mb="sm">
            Rémunération
          </Title>
          <Text size="sm">{PAY_MODES[instructor.payMode]}</Text>
          <Text mt="xs" size="xl" fw={600} className="tabular-nums">
            {formatEuros(instructor.rateCents)}{" "}
            <Text span size="sm" fw={400} c="dimmed">
              / {PAY_UNITS[instructor.payMode]}
            </Text>
          </Text>
          <Text mt="xs" size="xs" c="dimmed">
            Tarif de référence. Ce montant n’est pas un relevé à payer.
          </Text>
        </Paper>
      </div>
      {ownRates.length > 0 && (
        <Paper withBorder p="md" component="section" aria-labelledby="tarifs-cours">
          <Title order={2} size="h5" id="tarifs-cours" mb="xs">
            Cours à un autre tarif
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            {courseRateAllowed(instructor.payMode)
              ? `Pour ces cours, ce tarif remplace le tarif habituel de ${instructor.firstName}.`
              : "Ces tarifs ne s’appliquent pas pour l’instant (forfait mensuel, règle en attente)."}
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
                    <TableTd>
                      {c.weekday
                        ? `${DAY_NAMES[c.weekday]} ${c.startTime}–${end(c.startTime, c.durationMinutes)}`
                        : "À des dates précises"}
                    </TableTd>
                    <TableTd className="whitespace-nowrap">{c.season}</TableTd>
                    <TableTd ta="right" className="whitespace-nowrap tabular-nums">
                      {/* In the unit it was typed in (#268), which may be an older pay mode's. */}
                      {rateInCurrentUnit(c.ratePayMode, instructor.payMode) ? (
                        `${formatEuros(c.rateCents)} / ${PAY_UNITS[c.ratePayMode]}`
                      ) : !courseRateAllowed(instructor.payMode) ? (
                        <Text span size="sm" c="dimmed" td="line-through">
                          {formatEuros(c.rateCents)} / {PAY_UNITS[c.ratePayMode]}
                        </Text>
                      ) : (
                        <Text span size="sm" c="dimmed">
                          {formatEuros(c.rateCents)} / {PAY_UNITS[c.ratePayMode]}
                          <Text span size="xs" c="dimmed" display="block">
                            ancien mode de rémunération
                          </Text>
                        </Text>
                      )}
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
