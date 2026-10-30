import {
  Alert,
  Anchor,
  Paper,
  Table,
  TableTbody,
  TableTd,
  TableTfoot,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { Fragment } from "react";
import type { SeasonEnrollment } from "@/db/enrollments";
import type { PersonRecord } from "@/db/people";
import type { Season } from "@/db/schedule";
import { ENROLLMENT_STATUS_LABELS as STATUT } from "@/domain/enrollment/statuses";
import { amountDue, DUE_STATUSES } from "@/domain/payments/balance";
import { formatEuros } from "@/lib/money";
import { DAYS } from "../planning/format";
import { TextLink } from "../_ui/text-link";
import { EnrollmentChanges } from "./enrollment-change";
import { ENROLLMENTS_HEADING, EnrollmentStatusBadge } from "./enrollment-status";

/** Sections shared by the student and contact records. */

const PERIOD = { quarter: "trimestre", year: "année", single: "unité" } as const;
const PUBLIC = { child: "Enfant", adult: "Adulte", couple: "Couple", student: "Étudiant" } as const;
/** Text that needs attention (absences, expired document): the theme's readable amber, both modes. */
export const WARNING = "var(--mantine-color-yellow-light-color)";

const longDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
export const dayOf = (iso: string) => longDate.format(new Date(`${iso}T00:00:00Z`));

export const Telephone = ({ number }: { number: string }) => (
  <Anchor href={`tel:${number.replace(/\s/g, "")}`} size="sm" className="tabular-nums">
    {number}
  </Anchor>
);

export function Banner({ text }: { text?: string }) {
  if (!text) return null;
  return <Alert role="status">{text}</Alert>;
}

export function Notes({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <Alert color="yellow" role="region" aria-label="Santé et consignes">
      <Text size="sm" className="whitespace-pre-line">
        {notes}
      </Text>
    </Alert>
  );
}

export function FollowedCourses({ courses }: { courses: PersonRecord["courses"] }) {
  const season = courses[0]?.season;
  const current = courses.filter((c) => c.season === season);
  const history = courses.filter((c) => c.season !== season);
  return (
    <>
      <section aria-labelledby="cours" className="flex flex-col gap-2">
        <Title order={2} size="h5" id="cours">
          Cours{season && ` ${season}`}
        </Title>
        {current.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucun cours pour l’instant.
          </Text>
        ) : (
          <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
            {current.map((c) => (
              <li key={`${c.id}-${c.status}`} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <TextLink href={`/planning/cours/${c.id}`} size="sm" fw={500}>
                  {c.discipline}
                  {c.level && ` ${c.level}`}
                </TextLink>
                <span className="tabular-nums">
                  {c.weekday ? DAYS[c.weekday] : "Stage"} {c.startTime}
                </span>
                {c.presents + c.absents > 0 && (
                  <Text span size="xs" c={c.absents > c.presents ? WARNING : "dimmed"}>
                    présent {c.presents} fois sur {c.presents + c.absents}
                  </Text>
                )}
                <span className="ml-auto">
                  {c.status === "active" ? (
                    <Text span size="xs" c="dimmed">
                      {STATUT.active}
                    </Text>
                  ) : (
                    <EnrollmentStatusBadge status={c.status} droppedOn={c.droppedOn} />
                  )}
                </span>
              </li>
            ))}
          </Paper>
        )}
      </section>
      {history.length > 0 && (
        <section aria-labelledby="historique" className="flex flex-col gap-2">
          <Title order={2} size="h5" id="historique">
            Saisons précédentes
          </Title>
          <Text component="ul" size="sm" c="dimmed" className="flex flex-col gap-1">
            {history.map((c) => (
              <li key={`${c.id}-${c.status}`}>
                {c.season} : {c.discipline}
                {c.level && ` ${c.level}`} ({STATUT[c.status].toLowerCase()})
              </li>
            ))}
          </Text>
        </section>
      )}
    </>
  );
}

/**
 * Enrollments of the season (#284): every status, each with what the front desk can do
 * (confirm, drop-out, cancel). The total is what `payerId` owes for them (`amountDue`, the
 * balance's rule): a commitment, not a payment; trial and waitlist are left out. Without
 * `payerId` (a student whose enrollments someone else pays), no total.
 */
export function Enrollments({
  enrollments,
  season,
  today,
  payerId,
}: {
  enrollments: SeasonEnrollment[];
  season: Season;
  today: string;
  payerId: string | null;
}) {
  if (enrollments.length === 0) return null;
  const paid = enrollments.filter((i) => i.payerId === payerId);
  const total = amountDue(paid);
  const apart = paid.some((i) => !DUE_STATUSES.includes(i.status));
  return (
    <section aria-labelledby={ENROLLMENTS_HEADING} className="flex flex-col gap-2">
      <Title order={2} size="h5" id={ENROLLMENTS_HEADING} tabIndex={-1}>
        Inscriptions {season.label}
      </Title>
      <Paper withBorder className="overflow-x-auto">
        <Table>
          <TableThead>
            <TableTr>
              <TableTh scope="col">Élève</TableTh>
              <TableTh scope="col">Cours</TableTh>
              <TableTh scope="col" className="hidden sm:table-cell">
                Formule
              </TableTh>
              <TableTh scope="col" ta="right">
                Prix
              </TableTh>
              <TableTh scope="col" className="hidden sm:table-cell">
                <span className="sr-only">Actions</span>
              </TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {enrollments.map((i) => {
              const owed = DUE_STATUSES.includes(i.status) && i.payerId === payerId;
              const changes = (
                <EnrollmentChanges
                  enrollment={i}
                  today={today}
                  season={{ startDate: season.startDate, endDate: season.endDate }}
                />
              );
              return (
                <Fragment key={i.id}>
                  <TableTr className="max-sm:[&>td]:border-b-0">
                    <TableTd fw={500}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {i.students}
                        <EnrollmentStatusBadge status={i.status} droppedOn={i.droppedOn} />
                      </span>
                    </TableTd>
                    <TableTd>
                      {i.courses.join(", ")}
                      {i.entity && (
                        <Text size="xs" c="dimmed">
                          Entreprise : {i.entity}
                        </Text>
                      )}
                    </TableTd>
                    <TableTd className="hidden sm:table-cell">
                      {PUBLIC[i.audience]}, {PERIOD[i.period]}
                    </TableTd>
                    <TableTd ta="right" className="tabular-nums" c={owed ? undefined : "dimmed"}>
                      {formatEuros(i.netPriceCents)}
                      {i.priceReason && (
                        // A price typed by the front desk (#292): its reason under it.
                        <Text size="xs" c="dimmed" ta="right">
                          Prix saisi : {i.priceReason}
                        </Text>
                      )}
                    </TableTd>
                    <TableTd className="hidden sm:table-cell">{changes}</TableTd>
                  </TableTr>
                  {/* Phone: the actions on their own line under the row, never cut at the right edge. */}
                  <TableTr className="sm:hidden">
                    <TableTd colSpan={3} pt={0}>
                      {changes}
                    </TableTd>
                  </TableTr>
                </Fragment>
              );
            })}
          </TableTbody>
          {paid.length > 0 && (
            <TableTfoot>
              <TableTr>
                <TableTd colSpan={2} ta="right" fw={500} className="sm:hidden">
                  Total
                </TableTd>
                <TableTd colSpan={3} ta="right" fw={500} className="hidden sm:table-cell">
                  Total de la saison (montant inscrit)
                </TableTd>
                <TableTd ta="right" fw={600} className="tabular-nums">
                  {formatEuros(total)}
                </TableTd>
                <TableTd className="hidden sm:table-cell" />
              </TableTr>
            </TableTfoot>
          )}
        </Table>
      </Paper>
      {apart && (
        <Text size="xs" c="dimmed">
          Les inscriptions à l’essai ou en attente ne sont pas comptées dans le total.
        </Text>
      )}
    </section>
  );
}
