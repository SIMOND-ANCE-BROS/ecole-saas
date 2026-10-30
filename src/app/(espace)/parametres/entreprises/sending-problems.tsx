import { Badge, Paper, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from "@mantine/core";
import type { SendingProblem } from "@/db/invoice-outbox";
import { sendFailureReason } from "@/domain/invoicing/outbox";
import { displayedName } from "@/domain/people/name";
import { formatEuros } from "@/lib/money";
import { TextLink } from "../../_ui/text-link";
import { ProblemActions } from "./problem-actions";

const dateFr = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short" });

const tries = (n: number) => `${n} essai${n > 1 ? "s" : ""}`;

/** What management does about the invoice, in French. */
function nextStep(p: SendingProblem): string {
  if (p.status === "issued")
    return p.toolTotalInclTaxCents === null
      ? "Un avoir est à faire dans l’outil de facturation pour la corriger."
      : `Émise par l’outil pour ${formatEuros(p.toolTotalInclTaxCents)} au lieu de ${formatEuros(p.totalInclTaxCents)} : un avoir est à faire dans l’outil de facturation pour la corriger.`;
  if (p.linesGivenBack)
    return `Arrêtée après ${tries(p.attempts)}. Une fois la cause réglée, « Envoyer à nouveau » la prépare de nouveau et l’envoie ; « Abandonner » la retire de la liste.`;
  return `Arrêtée après ${tries(p.attempts)}, alors que l’outil de facturation en garde un brouillon. Une fois la cause réglée, « Envoyer à nouveau » reprend ce brouillon ; sinon supprimez-le dans l’outil, puis « Abandonner ». Ses lignes ne seront pas refacturées d’ici là.`;
}

/** The actions on a rejected invoice; none on one issued with another total (a credit note is due). */
const Actions = ({ p }: { p: SendingProblem }) =>
  p.status === "rejected" ? (
    <ProblemActions
      invoiceId={p.id}
      inTool={!p.linesGivenBack}
      payer={displayedName({ name: p.payer, firstName: p.payerFirstName, companyName: p.payerCompanyName })}
    />
  ) : null;

function State({ p }: { p: SendingProblem }) {
  if (p.status === "issued")
    return (
      <div>
        <Badge color="orange" variant="light">
          Émise
        </Badge>
        <Text size="xs" className="whitespace-nowrap tabular-nums">
          n° {p.number}
        </Text>
      </div>
    );
  return (
    <Badge color="red" variant="light">
      Non émise
    </Badge>
  );
}

const Payer = ({ p }: { p: SendingProblem }) => (
  <TextLink href={`/personnes/${p.payerId}`} size="sm">
    {displayedName({ name: p.payer, firstName: p.payerFirstName, companyName: p.payerCompanyName })}
  </TextLink>
);

/**
 * Invoices the sending to the invoicing tool gave up on, and invoices the tool issued with
 * another total (#304): management only, with the reason in French. Nothing shown when none.
 * A table on a computer, one card per invoice on a phone (DESIGN.md).
 */
export function SendingProblems({ problems, showEntity }: { problems: SendingProblem[]; showEntity: boolean }) {
  if (problems.length === 0) return null;
  return (
    <Paper withBorder p="md" className="flex flex-col gap-3">
      <div>
        <Title order={2} fz="lg">
          Factures à reprendre
        </Title>
        <Text size="sm" c="dimmed">
          L’outil de facturation n’a pas pu émettre ces factures, ou les a émises avec un autre total.
        </Text>
      </div>
      <ul className="flex flex-col gap-3 sm:hidden">
        {problems.map((p) => (
          <li key={p.id} className="flex flex-col gap-1 border-t border-bordure pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <Payer p={p} />
              <Text size="sm" className="whitespace-nowrap tabular-nums">
                {formatEuros(p.totalInclTaxCents)}
              </Text>
            </div>
            <div className="flex items-center gap-2">
              <State p={p} />
              <Text size="xs" c="dimmed" className="tabular-nums">
                {dateFr.format(p.createdAt)}
                {showEntity ? ` · ${p.billingEntity}` : ""}
              </Text>
            </div>
            <Text size="sm">{sendFailureReason(p.sendErrorKind, p.sendErrorCode)}</Text>
            <Text size="xs" c="dimmed">
              {nextStep(p)}
            </Text>
            <Actions p={p} />
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table striped verticalSpacing="xs">
          <TableThead>
            <TableTr>
              <TableTh>Créée le</TableTh>
              {showEntity && <TableTh>Entreprise</TableTh>}
              <TableTh>Facturé à</TableTh>
              <TableTh ta="right" className="whitespace-nowrap">
                Total TTC
              </TableTh>
              <TableTh>État</TableTh>
              <TableTh>Motif</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {problems.map((p) => (
              <TableTr key={p.id}>
                <TableTd className="whitespace-nowrap tabular-nums">{dateFr.format(p.createdAt)}</TableTd>
                {showEntity && <TableTd>{p.billingEntity}</TableTd>}
                <TableTd>
                  <Payer p={p} />
                </TableTd>
                <TableTd ta="right" className="whitespace-nowrap tabular-nums">
                  {formatEuros(p.totalInclTaxCents)}
                </TableTd>
                <TableTd>
                  <State p={p} />
                </TableTd>
                <TableTd>
                  <Text size="sm">{sendFailureReason(p.sendErrorKind, p.sendErrorCode)}</Text>
                  <Text size="xs" c="dimmed">
                    {nextStep(p)}
                  </Text>
                  <div className="mt-1">
                    <Actions p={p} />
                  </div>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </div>
    </Paper>
  );
}
