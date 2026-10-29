import type { Metadata } from "next";
import {
  Anchor,
  Badge,
  Table,
  TableCaption,
  TableTbody,
  TableTd,
  TableTfoot,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from "@mantine/core";
import { withSchool } from "@/db";
import { statementData } from "@/db/statements";
import { monthOf, ofMonth, validMonth } from "@/domain/payroll/month";
import { PAY_UNITS } from "@/domain/payroll/rate-field";
import { FLAG_SHORT, hoursLabel, monthStatement } from "@/domain/payroll/statement";
import { todayInParis } from "@/domain/people/age";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { BackToList } from "../../_ui/list-return";
import { PageHeader } from "../../_ui/page-header";
import { PHONE_LABEL, PHONE_TABLE } from "../../_ui/phone-table";
import { TextLink } from "../../_ui/text-link";
import { PAY_MODES } from "@/db/instructors";
import { MonthNav } from "./month-nav";
import { MonthNotice } from "./month-notice";

export const metadata: Metadata = { title: "Relevés des intervenants" };

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
const number = `${PHONE_TABLE.cell} text-right tabular-nums max-sm:text-left`;

/**
 * What the school owes each instructor for a month (#285), management only:
 * computed live from the lessons taught, nothing stored.
 */
export default async function StatementsPage({ searchParams }: PageProps<"/intervenants/releves">) {
  const { schoolId } = await requireRole("director");
  const { mois } = await searchParams;
  const today = todayInParis();
  const month = validMonth(mois) ?? monthOf(today);
  const data = await withSchool(schoolId, (tx) => statementData(tx, month));
  const m = monthStatement({ month, today, ...data });
  const title = `Relevés ${ofMonth(month)}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/intervenants" size="sm">
          Intervenants
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" "}
          / Relevés
        </Text>
      </nav>
      <PageHeader
        title={title}
        description={
          m.statements.length > 0
            ? `${plural(m.statements.length, "intervenant")}, ${plural(m.lessonCount, "séance")}, ${formatEuros(m.totalCents)} dus${m.toPriceCount > 0 ? `, ${plural(m.toPriceCount, "séance")} à chiffrer en plus` : ""}`
            : "Ce que l’école doit à chaque intervenant, séance par séance."
        }
        actions={
          m.statements.length > 0 && (
            <Anchor href={`/intervenants/releves/export?mois=${month}`} size="sm">
              Exporter le mois (CSV)
            </Anchor>
          )
        }
      />
      <MonthNav base="/intervenants/releves" month={month} />
      <MonthNotice inProgress={m.inProgress} notStarted={m.notStarted} today={today} />
      {m.statements.length === 0 ? (
        <Text size="sm">Aucune séance ce mois-ci.</Text>
      ) : (
        <Table className={PHONE_TABLE.table} verticalSpacing="xs" highlightOnHover>
          <TableCaption className="sr-only">{title}</TableCaption>
          <TableThead className={PHONE_TABLE.head}>
            <TableTr>
              <TableTh>Intervenant</TableTh>
              <TableTh>Rémunération</TableTh>
              <TableTh className="text-right">Séances</TableTh>
              <TableTh className="text-right">Heures</TableTh>
              <TableTh className="text-right">Montant dû</TableTh>
              <TableTh>À vérifier</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody className={PHONE_TABLE.body}>
            {m.statements.map((s) => {
              const checks = [
                ...(s.toPriceCount > 0 ? [`${plural(s.toPriceCount, "séance")} à chiffrer`] : []),
                ...s.flags.map((f) => FLAG_SHORT[f]),
              ];
              return (
                <TableTr key={s.instructorId} className={PHONE_TABLE.row}>
                  <TableTd className={`${PHONE_TABLE.cell} ${PHONE_TABLE.title}`}>
                    <TextLink href={`/intervenants/${s.instructorId}/releve?mois=${month}`} size="sm" fw={500}>
                      {s.name}
                    </TextLink>
                  </TableTd>
                  <TableTd className={PHONE_TABLE.cell}>
                    <span className={PHONE_LABEL} aria-hidden>
                      Rémunération
                    </span>
                    {PAY_MODES[s.payMode]}, {formatEuros(s.rateCents)} / {PAY_UNITS[s.payMode]}
                  </TableTd>
                  <TableTd className={number}>
                    <span className={PHONE_LABEL} aria-hidden>
                      Séances
                    </span>
                    {s.lessonCount}
                  </TableTd>
                  <TableTd className={number}>
                    <span className={PHONE_LABEL} aria-hidden>
                      Heures
                    </span>
                    {hoursLabel(s.minutes)}
                  </TableTd>
                  <TableTd className={`${number} font-medium`}>
                    <span className={PHONE_LABEL} aria-hidden>
                      Montant dû
                    </span>
                    {formatEuros(s.totalCents)}
                  </TableTd>
                  <TableTd className={`${PHONE_TABLE.cell} ${PHONE_TABLE.title}`}>
                    <span className={PHONE_LABEL} aria-hidden>
                      À vérifier
                    </span>
                    {checks.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {checks.map((c) => (
                          <Badge key={c} color="yellow" variant="light" tt="none" fw={500}>
                            {c}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <Text span size="sm" c="dimmed">
                        Rien
                      </Text>
                    )}
                  </TableTd>
                </TableTr>
              );
            })}
          </TableTbody>
          <TableTfoot className={PHONE_TABLE.body}>
            <TableTr className={`${PHONE_TABLE.row} font-semibold`}>
              <TableTh className={`${PHONE_TABLE.cell} ${PHONE_TABLE.title}`} scope="row">
                Total
              </TableTh>
              <TableTd className={`${PHONE_TABLE.cell} max-sm:hidden`} />
              <TableTd className={number}>
                <span className={PHONE_LABEL} aria-hidden>
                  Séances
                </span>
                {m.lessonCount}
              </TableTd>
              <TableTd className={number}>
                <span className={PHONE_LABEL} aria-hidden>
                  Heures
                </span>
                {hoursLabel(m.minutes)}
              </TableTd>
              <TableTd className={number}>
                <span className={PHONE_LABEL} aria-hidden>
                  Montant dû
                </span>
                {formatEuros(m.totalCents)}
              </TableTd>
              <TableTd className={PHONE_TABLE.cell}>
                {m.toPriceCount > 0 && (
                  <Text span size="sm" fw={400}>
                    {plural(m.toPriceCount, "séance")} à chiffrer, hors total
                  </Text>
                )}
              </TableTd>
            </TableTr>
          </TableTfoot>
        </Table>
      )}
    </section>
  );
}
