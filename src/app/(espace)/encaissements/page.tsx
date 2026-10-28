import type { Metadata } from "next";
import {
  Alert,
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
import { withSchool } from "@/db";
import { PAYMENT_METHODS, type Method } from "@/db/payments";
import { paymentLog, listDeposits, paymentsToDeposit } from "@/db/deposits";
import { DEPOSIT_METHODS, totals } from "@/domain/payments/deposits";
import { validDate } from "@/domain/schedule/week";
import { todayInParis } from "@/domain/people/age";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { ButtonLink } from "../_ui/button-link";
import { TextLink } from "../_ui/text-link";
import { JournalFilters } from "./journal-filters";
import { ToDeposit } from "./to-deposit";
import { isKeyOf } from "@/lib/has";

export const metadata: Metadata = { title: "Encaissements" };

const VIEWS = { journal: "Journal", remettre: "À remettre", remises: "Remises" } as const;
type View = keyof typeof VIEWS;
const day = (iso: string) => iso.split("-").reverse().join("/");

/** Payments (#98): log by period, payments to deposit at the bank, bank deposits and deposit slips. */
export default async function PaymentsPage({ searchParams }: PageProps<"/encaissements">) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const p = await searchParams;
  const view: View = typeof p.vue === "string" && isKeyOf(VIEWS, p.vue) ? p.vue : "journal";
  const today = todayInParis();
  const from = validDate(p.du) ?? `${today.slice(0, 8)}01`;
  const to = validDate(p.au) ?? today;
  const method = typeof p.moyen === "string" && isKeyOf(PAYMENT_METHODS, p.moyen) ? p.moyen : null;

  const parsed = await withSchool(schoolId, async (tx) => ({
    journal: view === "journal" ? await paymentLog(tx, from, to, method) : [],
    toDeposit: view === "remettre" ? await paymentsToDeposit(tx, today) : null,
    remises: view === "remises" ? await listDeposits(tx) : [],
  }));
  const t = totals(parsed.journal);
  const exportUrl = `/encaissements/export?${new URLSearchParams({ du: from, au: to, ...(method ? { moyen: method } : {}) })}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <Title order={1} fz="xl">
        Encaissements
      </Title>
      {p.annulee && <Alert role="status">Remise annulée : ses paiements sont de nouveau à remettre.</Alert>}
      <nav aria-label="Vues" className="flex flex-wrap gap-2">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <ButtonLink
            key={v}
            href={`/encaissements?vue=${v}`}
            aria-current={view === v ? "page" : undefined}
            // Not a filled button: it would compete with « Créer la remise ».
            variant={view === v ? "light" : "default"}
            size="sm"
          >
            {VIEWS[v]}
          </ButtonLink>
        ))}
      </nav>

      {view === "journal" && (
        <>
          <JournalFilters
            key={`${from}|${to}|${method ?? ""}`}
            from={from}
            to={to}
            method={method}
            exportUrl={exportUrl}
          />
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <Text component="dt" size="sm" className="inline" c="dimmed">
                Total :{" "}
              </Text>
              <Text component="dd" size="sm" fw={600} className="inline tabular-nums">
                {formatEuros(t.total)}
              </Text>
            </div>
            {Object.entries(t.byMethod).map(([m, c]) => (
              <div key={m}>
                <Text component="dt" size="sm" className="inline" c="dimmed">
                  {PAYMENT_METHODS[m as Method]} :{" "}
                </Text>
                <Text component="dd" size="sm" className="inline tabular-nums">
                  {formatEuros(c)}
                </Text>
              </div>
            ))}
          </dl>
          {parsed.journal.length === 0 ? (
            <Text size="sm" c="dimmed">
              Aucun encaissement sur cette période.
            </Text>
          ) : (
            <Paper withBorder className="overflow-x-auto">
              <Table highlightOnHover>
                <TableCaption className="sr-only">
                  Encaissements du {day(from)} au {day(to)}
                </TableCaption>
                <TableThead>
                  <TableTr>
                    <TableTh>Reçu le</TableTh>
                    <TableTh>Payeur</TableTh>
                    <TableTh>Moyen</TableTh>
                    <TableTh>Référence</TableTh>
                    <TableTh ta="right">Montant</TableTh>
                    <TableTh>Encaissement</TableTh>
                    <TableTh>Remise</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {parsed.journal.map((l) => (
                    <TableTr key={l.id} c={l.amountCents < 0 ? "dimmed" : undefined}>
                      <TableTd className="whitespace-nowrap">{day(l.date)}</TableTd>
                      <TableTd>
                        <TextLink href={`/personnes/${l.payerId}`} size="sm">
                          {l.payer}
                        </TextLink>
                      </TableTd>
                      <TableTd>{PAYMENT_METHODS[l.method]}</TableTd>
                      <TableTd>{[l.reference, l.issuer].filter(Boolean).join(", ") || "—"}</TableTd>
                      <TableTd ta="right" className="tabular-nums whitespace-nowrap">
                        {formatEuros(l.amountCents)}
                      </TableTd>
                      <TableTd className="whitespace-nowrap">
                        {l.plannedPayment && l.plannedPayment > today ? `le ${day(l.plannedPayment)}` : "—"}
                      </TableTd>
                      <TableTd className="whitespace-nowrap">
                        {l.depositId ? (
                          <TextLink href={`/encaissements/remises/${l.depositId}`} size="sm">
                            {day(l.dateDeposit as string)}
                          </TextLink>
                        ) : (
                          "—"
                        )}
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </Paper>
          )}
        </>
      )}

      {view === "remettre" && parsed.toDeposit && (
        <>
          <Text size="sm" c="dimmed">
            Chèques dont la date d’encaissement est arrivée, espèces et chèques vacances pas encore déposés.
          </Text>
          {DEPOSIT_METHODS.every((m) => parsed.toDeposit![m].length === 0) && (
            <Text size="sm">Rien à remettre pour l’instant.</Text>
          )}
          {DEPOSIT_METHODS.filter((m) => parsed.toDeposit![m].length > 0).map((m) => (
            <ToDeposit key={m} method={m} payments={parsed.toDeposit![m]} today={today} />
          ))}
        </>
      )}

      {view === "remises" &&
        (parsed.remises.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucune remise pour l’instant.
          </Text>
        ) : (
          <Paper withBorder className="overflow-x-auto">
            <Table highlightOnHover>
              <TableCaption className="sr-only">Remises en banque</TableCaption>
              <TableThead>
                <TableTr>
                  <TableTh>Date</TableTh>
                  <TableTh>Moyen</TableTh>
                  <TableTh ta="right">Paiements</TableTh>
                  <TableTh ta="right">Total</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {parsed.remises.map((r) => (
                  <TableTr key={r.id}>
                    <TableTd>
                      <TextLink href={`/encaissements/remises/${r.id}`} size="sm">
                        {day(r.date)}
                      </TextLink>
                    </TableTd>
                    <TableTd>{PAYMENT_METHODS[r.method]}</TableTd>
                    <TableTd ta="right" className="tabular-nums">
                      {r.count}
                    </TableTd>
                    <TableTd ta="right" className="tabular-nums">
                      {formatEuros(r.totalCents)}
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </Paper>
        ))}
    </section>
  );
}
