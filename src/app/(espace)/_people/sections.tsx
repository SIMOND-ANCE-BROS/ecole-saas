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
import type { PaidEnrollment } from "@/db/enrollments";
import type { PersonRecord } from "@/db/people";
import { ENROLLMENT_STATUS_LABELS as STATUT } from "@/domain/enrollment/statuses";
import { formatEuros } from "@/lib/money";
import { DAYS } from "../planning/format";
import { TextLink } from "../_ui/text-link";

/** Sections shared by the student and contact records. */

const DOCUMENT = {
  medical_certificate: "Certificat médical",
  parental_consent: "Autorisation parentale",
  image_rights: "Droit à l’image",
  other: "Autre document",
} as const;
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
                <Text
                  span
                  size="xs"
                  ml="auto"
                  c={c.status === "active" ? "dimmed" : WARNING}
                  fw={c.status === "active" ? undefined : 500}
                >
                  {STATUT[c.status]}
                </Text>
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

export function Documents({ documents, today }: { documents: PersonRecord["documents"]; today: string }) {
  return (
    <section aria-labelledby="documents" className="flex flex-col gap-2">
      <Title order={2} size="h5" id="documents">
        Documents
      </Title>
      {documents.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun document enregistré (certificat médical, autorisations).
        </Text>
      ) : (
        <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
          {documents.map((d, i) => {
            const expiresAt = d.validUntil !== null && d.validUntil < today;
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <span className="font-medium">{DOCUMENT[d.type]}</span>
                <Text span size="sm" c={expiresAt || !d.granted ? WARNING : "dimmed"}>
                  {!d.granted
                    ? "refusé"
                    : d.validUntil
                      ? `${expiresAt ? "expiré le" : "valable jusqu’au"} ${dayOf(d.validUntil)}`
                      : "fourni"}
                </Text>
              </li>
            );
          })}
        </Paper>
      )}
    </section>
  );
}

/** Enrollments invoiced to a person: a commitment, not a payment. */
export function BilledEnrollments({ enrollments, season }: { enrollments: PaidEnrollment[]; season: string }) {
  if (enrollments.length === 0) return null;
  const total = enrollments.reduce((s, i) => s + i.netPriceCents, 0);
  return (
    <section aria-labelledby="facturees" className="flex flex-col gap-2">
      <Title order={2} size="h5" id="facturees">
        Inscriptions facturées {season}
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
            </TableTr>
          </TableThead>
          <TableTbody>
            {enrollments.map((i) => (
              <TableTr key={i.id}>
                <TableTd fw={500}>{i.students}</TableTd>
                <TableTd>{i.courses.join(", ")}</TableTd>
                <TableTd className="hidden sm:table-cell">
                  {PUBLIC[i.audience]}, {PERIOD[i.period]}
                </TableTd>
                <TableTd ta="right" className="tabular-nums">
                  {formatEuros(i.netPriceCents)}
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
          <TableTfoot>
            <TableTr>
              <TableTd colSpan={2} ta="right" fw={500} className="sm:hidden">
                Total
              </TableTd>
              <TableTd colSpan={3} ta="right" fw={500} className="hidden sm:table-cell">
                Total de la saison (montant inscrit, ni encaissé ni dû à ce jour)
              </TableTd>
              <TableTd ta="right" fw={600} className="tabular-nums">
                {formatEuros(total)}
              </TableTd>
            </TableTr>
          </TableTfoot>
        </Table>
      </Paper>
    </section>
  );
}
