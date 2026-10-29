import type { Metadata } from "next";
import {
  Alert,
  Anchor,
  Badge,
  List,
  ListItem,
  Paper,
  Table,
  TableCaption,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { PAY_MODES } from "@/db/instructors";
import { statementData } from "@/db/statements";
import { monthLabel, monthOf, validMonth } from "@/domain/payroll/month";
import { PAY_UNITS } from "@/domain/payroll/rate-field";
import {
  FLAG_TEXTS,
  hasStatement,
  hoursLabel,
  IN_FLAT,
  instructorStatement,
  monthState,
  NO_ATTENDANCE,
  SUBSTITUTE,
  TO_PRICE_REASONS,
  type StatementLine,
} from "@/domain/payroll/statement";
import { todayInParis } from "@/domain/people/age";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { BackToList } from "@/app/(espace)/_ui/list-return";
import { PageHeader } from "@/app/(espace)/_ui/page-header";
import { PHONE_LABEL, PHONE_TABLE } from "@/app/(espace)/_ui/phone-table";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { end, shortDate } from "@/app/(espace)/planning/format";
import { MonthNav } from "../../releves/month-nav";
import { MonthNotice } from "../../releves/month-notice";

export const metadata: Metadata = { title: "Relevé de l’intervenant" };

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
const number = `${PHONE_TABLE.cell} text-right tabular-nums max-sm:text-left`;
const capitalised = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

/** Typographic space before a French « : » (U+00A0). */
const NBSP = " ";

/**
 * One instructor's statement for a month (#285), management only: the
 * lessons they taught, by course, each with its rate and amount, and what is
 * left to price or to check. Computed live, nothing stored.
 */
export default async function InstructorStatementPage({
  params,
  searchParams,
}: PageProps<"/intervenants/[id]/releve">) {
  const { schoolId } = await requireRole("director");
  const { id } = await params;
  const { mois } = await searchParams;
  const today = todayInParis();
  const month = validMonth(mois) ?? monthOf(today);
  const data = await withSchool(schoolId, (tx) => statementData(tx, month, id));
  const instructor = data.instructors[0];
  if (!instructor) notFound();
  const s = instructorStatement({
    month,
    today,
    instructor,
    lessons: data.lessons,
    rateChanges: data.rateChanges,
    closures: data.closures,
  });
  const owner = !hasStatement(instructor);
  const { inProgress, notStarted } = monthState(month, today);
  const flat = s.payMode === "monthly_flat";
  const label = monthLabel(month);
  const rate = `${formatEuros(s.rateCents)} / ${PAY_UNITS[s.payMode]}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/intervenants" size="sm">
          Intervenants
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" / "}
        </Text>
        <TextLink href={`/intervenants/${id}`} size="sm">
          {s.name}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Relevé
        </Text>
      </nav>
      <PageHeader
        title={`Relevé de ${s.name}, ${label}`}
        description={
          owner
            ? undefined
            : `Payé ${flat ? "au forfait mensuel" : PAY_MODES[s.payMode]}${NBSP}: ${rate}. Calculé avec les séances et les tarifs d’aujourd’hui.`
        }
        actions={
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <TextLink href={`/intervenants/releves?mois=${month}`} size="sm">
              Tous les relevés du mois
            </TextLink>
            {!owner && s.lessonCount > 0 && (
              <Anchor href={`/intervenants/releves/export?mois=${month}&intervenant=${id}`} size="sm">
                Exporter (CSV)
              </Anchor>
            )}
          </div>
        }
      />
      {owner ? (
        <Text size="sm">
          Les dirigeants de l’école n’ont pas de relevé : ils ne facturent pas leurs séances à l’école.
        </Text>
      ) : (
        <>
          <MonthNav base={`/intervenants/${id}/releve`} month={month} />
          <MonthNotice inProgress={inProgress} notStarted={notStarted} today={today} />

          {(s.flags.length > 0 || s.toPriceCount > 0) && (
            <Alert color="yellow" title="À vérifier" role="region" aria-label="À vérifier">
              <List size="sm" spacing={4}>
                {s.toPriceCount > 0 && (
                  <ListItem>
                    {plural(s.toPriceCount, "séance")} à chiffrer{NBSP}:{" "}
                    {s.toPriceCount > 1 ? "elles ne sont" : "elle n’est"} pas comptée
                    {s.toPriceCount > 1 ? "s" : ""} dans le montant dû.
                  </ListItem>
                )}
                {s.flags.map((f) => (
                  <ListItem key={f}>{FLAG_TEXTS[f]}</ListItem>
                ))}
              </List>
            </Alert>
          )}

          <Paper withBorder p="md" component="section" aria-labelledby="total">
            <Title order={2} size="h5" id="total" className="sr-only">
              Montant dû
            </Title>
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              <Figure label="Séances comptées" value={String(s.lessonCount)} />
              <Figure label="Heures" value={hoursLabel(s.minutes)} />
              {flat && (
                <Figure
                  label="Forfait mensuel"
                  value={s.flatCents === null ? "Non compté" : formatEuros(s.flatCents)}
                />
              )}
              {s.toPriceCount > 0 && <Figure label="À chiffrer" value={plural(s.toPriceCount, "séance")} />}
              <Figure label="Montant dû" value={formatEuros(s.totalCents)} strong />
            </dl>
            {s.nobodyCameCount > 0 && (
              <Text size="sm" c="dimmed" mt="sm">
                {s.nobodyCameCount > 1
                  ? `${s.nobodyCameCount} séances sans aucun élève présent ne sont pas payées`
                  : "1 séance sans aucun élève présent n’est pas payée"}{" "}
                (pas de cours, pas de paiement).
              </Text>
            )}
          </Paper>

          {s.courses.length === 0 ? (
            <Text size="sm">Aucune séance ce mois-ci.</Text>
          ) : (
            s.courses.map((c) => (
              <Paper key={c.courseId} withBorder p="md" component="section" aria-labelledby={`cours-${c.courseId}`}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <Title order={2} size="h5" id={`cours-${c.courseId}`}>
                    {c.courseLabel}
                  </Title>
                  <Text size="sm" c="dimmed" className="tabular-nums">
                    {plural(c.lines.length, "séance")}, {hoursLabel(c.minutes)}
                    {/* Only lessons priced add up here: a course whose lessons are all « à chiffrer » has no amount. */}
                    {c.lines.some((l) => l.amountCents !== null) && `, ${formatEuros(c.amountCents)}`}
                  </Text>
                </div>
                <Table className={PHONE_TABLE.table} verticalSpacing="xs">
                  <TableCaption className="sr-only">Séances de {c.courseLabel}</TableCaption>
                  <TableThead className={PHONE_TABLE.head}>
                    <TableTr>
                      <TableTh>Date</TableTh>
                      <TableTh>Horaire</TableTh>
                      <TableTh className="text-right">Durée</TableTh>
                      <TableTh className="text-right">Taux</TableTh>
                      <TableTh className="text-right">Montant</TableTh>
                      <TableTh>Remarque</TableTh>
                    </TableTr>
                  </TableThead>
                  <TableTbody className={PHONE_TABLE.body}>
                    {c.lines.map((l) => (
                      <Line key={l.lessonId} line={l} flat={flat} courseId={c.courseId} />
                    ))}
                  </TableTbody>
                </Table>
              </Paper>
            ))
          )}
        </>
      )}
    </section>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <Text component="dt" size="sm" c="dimmed">
        {label}
      </Text>
      <Text component="dd" size={strong ? "xl" : "lg"} fw={strong ? 600 : 500} className="tabular-nums">
        {value}
      </Text>
    </div>
  );
}

function Line({ line: l, flat, courseId }: { line: StatementLine; flat: boolean; courseId: string }) {
  const reason = l.toPrice ? capitalised(TO_PRICE_REASONS[l.toPrice]) : null;
  return (
    <TableTr className={PHONE_TABLE.row}>
      <TableTd className={`${PHONE_TABLE.cell} ${PHONE_TABLE.title}`}>
        {/* The lesson's page: attendance, substitute, cancellation. */}
        <TextLink href={`/planning/seances/${l.lessonId}`} size="sm">
          {shortDate(l.date, true)}
        </TextLink>
      </TableTd>
      <TableTd className={`${PHONE_TABLE.cell} tabular-nums`}>
        <span className={PHONE_LABEL} aria-hidden>
          Horaire
        </span>
        {l.startTime}–{end(l.startTime, l.minutes)}
      </TableTd>
      <TableTd className={number}>
        <span className={PHONE_LABEL} aria-hidden>
          Durée
        </span>
        {hoursLabel(l.minutes)}
      </TableTd>
      <TableTd className={number}>
        <span className={PHONE_LABEL} aria-hidden>
          Taux
        </span>
        {l.rateCents === null || l.unit === null ? "—" : `${formatEuros(l.rateCents)} / ${PAY_UNITS[l.unit]}`}
      </TableTd>
      <TableTd className={number}>
        <span className={PHONE_LABEL} aria-hidden>
          Montant
        </span>
        {l.amountCents !== null ? (
          formatEuros(l.amountCents)
        ) : l.toPrice ? (
          <Badge color="yellow" variant="light" tt="none" fw={500}>
            à chiffrer
          </Badge>
        ) : (
          "—"
        )}
      </TableTd>
      <TableTd className={`${PHONE_TABLE.cell} ${PHONE_TABLE.title}`}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {l.substitute && (
            <Badge color="gray" variant="light" tt="none" fw={500}>
              {capitalised(SUBSTITUTE)}
            </Badge>
          )}
          {l.noAttendance && (
            <Badge color="yellow" variant="light" tt="none" fw={500}>
              {capitalised(NO_ATTENDANCE)}
            </Badge>
          )}
          {reason && (
            <Text span size="sm">
              {reason}
            </Text>
          )}
          {l.toPrice === "old_unit" && (
            <TextLink href={`/planning/cours/${courseId}`} size="sm">
              Corriger le tarif du cours
            </TextLink>
          )}
          {flat && !l.substitute && !l.toPrice && (
            <Text span size="sm" c="dimmed">
              {capitalised(IN_FLAT)}
            </Text>
          )}
        </span>
      </TableTd>
    </TableTr>
  );
}
