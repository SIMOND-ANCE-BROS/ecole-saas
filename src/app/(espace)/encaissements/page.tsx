import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
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
} from "@mantine/core";
import { withSchool } from "@/db";
import { PAYMENT_METHODS, type Method } from "@/db/payments";
import { readPreference } from "@/db/preferences";
import { PAYMENT_COLUMNS } from "@/domain/filters/columns";
import { toParams } from "@/domain/filters/filters";
import { offsetOf, PAGE_SIZE, readPage } from "@/domain/filters/pagination";
import { futureCashing, paymentLogQuery, referenceOf, shownPaymentLog } from "@/domain/payments/payment-log";
import { paymentLog, listDeposits, paymentsToDeposit } from "@/db/deposits";
import { listEntities } from "@/db/billing-entities";
import { totals } from "@/domain/payments/deposits";
import { validDate } from "@/domain/schedule/week";
import { todayInParis } from "@/domain/people/age";
import { frenchDate } from "@/lib/dates";
import { isKeyOf } from "@/lib/has";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { ListTable } from "../_filters/list-table";
import { ButtonLink } from "../_ui/button-link";
import { PageHeader } from "../_ui/page-header";
import { TextLink } from "../_ui/text-link";
import { JournalFilters } from "./journal-filters";
import { ToDeposit } from "./to-deposit";

export const metadata: Metadata = { title: "Encaissements" };

const VIEWS = { journal: "Journal", remettre: "À remettre", remises: "Remises" } as const;
type View = keyof typeof VIEWS;
const day = frenchDate;

/** Payments (#98): log by period, payments to deposit at the bank, bank deposits and deposit slips. */
export default async function PaymentsPage({ searchParams }: PageProps<"/encaissements">) {
  const { schoolId: schoolId, userId } = await requireRole("director", "front_desk");
  const p = await searchParams;
  const view: View = typeof p.vue === "string" && isKeyOf(VIEWS, p.vue) ? p.vue : "journal";
  const today = todayInParis();
  const from = validDate(p.du) ?? `${today.slice(0, 8)}01`;
  const to = validDate(p.au) ?? today;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(p))
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  const { filter, sort: currentSort, legacy } = paymentLogQuery(params, PAYMENT_METHODS);
  // An older `?moyen=` link: the same list, written with the column filter.
  if (legacy) {
    params.delete("moyen");
    params.delete("f");
    params.delete("mode");
    for (const [key, value] of toParams(filter)) params.append(key, value);
    redirect(`/encaissements?${params}`);
  }

  const parsed = await withSchool(schoolId, async (tx) => ({
    journal: view === "journal" ? await paymentLog(tx, from, to, null) : [],
    layout: view === "journal" ? await readPreference(tx, userId, "encaissements") : null,
    toDeposit: view === "remettre" ? await paymentsToDeposit(tx, today) : null,
    remises: view === "remises" ? await listDeposits(tx) : [],
    entities: await listEntities(tx),
  }));
  // A school with a single entity never sees it named (#300): no column, no filter, no heading.
  const several = parsed.entities.length > 1;
  const columns = several ? PAYMENT_COLUMNS : PAYMENT_COLUMNS.filter((c) => c.id !== "entreprise");
  // The column filters and sort (#107), the same rules as the CSV export.
  const shown = shownPaymentLog(
    parsed.journal.map((l) => ({ ...l, methodLabel: PAYMENT_METHODS[l.method] })),
    filter,
    currentSort,
    today,
  );
  const page = readPage(p.page, shown.length);
  // Totals of every row shown, all pages together: what the filters select.
  const t = totals(shown);
  const filtering = filter.conditions.length > 0;
  const listState: [string, string][] = [
    ...toParams(filter),
    ...(currentSort
      ? ([
          ["sort", currentSort.column],
          ["order", currentSort.direction],
        ] as [string, string][])
      : []),
  ];
  const exportUrl = `/encaissements/export?${new URLSearchParams([["du", from], ["au", to], ...listState])}`;
  const plural = (n: number) => `${n} encaissement${n > 1 ? "s" : ""}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <PageHeader
        title="Encaissements"
        live
        description={
          view === "journal"
            ? `${plural(shown.length)} du ${day(from)} au ${day(to)}${filtering ? " avec ces filtres" : ""}`
            : undefined
        }
      />
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
            key={`${from}|${to}`}
            from={from}
            to={to}
            keep={listState}
            // Nothing to export: no link to an empty file.
            exportUrl={shown.length > 0 ? exportUrl : null}
          />
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <Text component="dt" size="sm" className="inline" c="dimmed">
                {filtering ? "Total (filtres appliqués)" : "Total"} :{" "}
              </Text>
              <Text component="dd" size="sm" fw={600} className="inline tabular-nums">
                {formatEuros(t.total)}
              </Text>
            </div>
            {/* Always in the same order; a method netting to zero (a payment and its correction) is left out. */}
            {(Object.keys(PAYMENT_METHODS) as Method[])
              .filter((m) => (t.byMethod[m] ?? 0) !== 0)
              .map((m) => (
                <div key={m}>
                  <Text component="dt" size="sm" className="inline" c="dimmed">
                    {PAYMENT_METHODS[m]} :{" "}
                  </Text>
                  <Text component="dd" size="sm" className="inline tabular-nums">
                    {formatEuros(t.byMethod[m] ?? 0)}
                  </Text>
                </div>
              ))}
          </dl>
          {/* useSearchParams requires a Suspense boundary. */}
          <Suspense>
            <ListTable
              list="encaissements"
              what="des encaissements"
              caption={`Encaissements du ${day(from)} au ${day(to)}`}
              columns={columns}
              layout={parsed.layout}
              linkColumn="payeur"
              empty={
                parsed.journal.length === 0
                  ? "Aucun encaissement sur cette période."
                  : "Aucun encaissement ne correspond à ces filtres."
              }
              choice={{ moyen: Object.values(PAYMENT_METHODS), entreprise: parsed.entities.map((e) => e.name) }}
              pagination={{ page, total: shown.length, noun: "Encaissements" }}
              rows={shown.slice(offsetOf(page), offsetOf(page) + PAGE_SIZE).map((l) => ({
                id: l.id,
                href: `/personnes/${l.payerId}`,
                // A correction (negative amount) reads as such.
                dimmed: l.amountCents < 0,
                cells: {
                  recu: l.date,
                  payeur: l.payer,
                  moyen: l.methodLabel,
                  reference: referenceOf(l),
                  montant: formatEuros(l.amountCents),
                  encaissement: futureCashing(l, today),
                  remise: l.dateDeposit,
                  entreprise: l.entity,
                },
                links:
                  l.depositId && l.dateDeposit
                    ? {
                        remise: {
                          href: `/encaissements/remises/${l.depositId}`,
                          label: `Bordereau de la remise du ${day(l.dateDeposit)}`,
                        },
                      }
                    : undefined,
              }))}
            />
          </Suspense>
        </>
      )}

      {view === "remettre" && parsed.toDeposit && (
        <>
          <Text size="sm" c="dimmed">
            Chèques dont la date d’encaissement est arrivée, espèces et chèques vacances pas encore déposés.
          </Text>
          {parsed.toDeposit.length === 0 && <Text size="sm">Rien à remettre pour l’instant.</Text>}
          {/* One slip per entity and method: each business deposits into its own account (#300). */}
          {parsed.toDeposit.map((g) => (
            <ToDeposit
              key={`${g.billingEntityId}-${g.method}`}
              method={g.method}
              entity={{ id: g.billingEntityId, name: several ? g.payments[0].entity : null }}
              payments={g.payments}
              today={today}
            />
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
                  {several && <TableTh>Entreprise</TableTh>}
                  <TableTh ta="right">Paiements</TableTh>
                  <TableTh ta="right">Total</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {parsed.remises.map((r) => (
                  <TableTr key={r.id}>
                    <TableTd>
                      <TextLink
                        href={`/encaissements/remises/${r.id}`}
                        size="sm"
                        aria-label={`Remise du ${day(r.date)}, ${PAYMENT_METHODS[r.method].toLowerCase()}${several ? `, ${r.entity}` : ""}, ${formatEuros(r.totalCents)}`}
                      >
                        {day(r.date)}
                      </TextLink>
                    </TableTd>
                    <TableTd>{PAYMENT_METHODS[r.method]}</TableTd>
                    {several && <TableTd>{r.entity}</TableTd>}
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
