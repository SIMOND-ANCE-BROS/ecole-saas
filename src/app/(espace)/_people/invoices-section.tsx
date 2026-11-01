import { Badge, Paper, Text, Title } from "@mantine/core";
import { toolAvailable } from "@/connectors/invoicing/connector";
import type { PayerInvoice } from "@/db/payer-invoices";
import { type Connection, invoiceProgress, isUnsentDraft, type ProgressKind } from "@/domain/invoicing/progress";
import { TextLink } from "../_ui/text-link";
import { frenchDate } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { DraftInvoices } from "./draft-invoices";

const COLORS: Record<ProgressKind, string> = {
  held: "yellow",
  not_connected: "gray",
  sending: "blue",
  retrying: "orange",
  issued: "green",
  issued_mismatch: "orange",
  rejected: "red",
  cancelled: "gray",
};

/** Whether the invoice's business can send from this server. */
const connectionOf = (i: PayerInvoice): Connection =>
  i.connectorTool === null ? "none" : toolAvailable(i.connectorTool) ? "ready" : "unavailable";

const at = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

/** One invoice: its business, total, where it stands, its lines and installments. */
function InvoiceCard({ i, showEntity, isDirector }: { i: PayerInvoice; showEntity: boolean; isDirector: boolean }) {
  const p = invoiceProgress({
    ...i,
    installmentsCents: i.installments.map((d) => d.amountCents),
    connection: connectionOf(i),
  });
  const title = i.number
    ? `Facture n° ${i.number}`
    : i.status === "to_send" || i.status === "tool_draft"
      ? "Facture en préparation"
      : "Facture";
  const subtitle = [showEntity ? i.billingEntity : null, i.issuedOn ? `émise le ${frenchDate(i.issuedOn)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col">
          <Text size="sm" fw={600} className="break-all tabular-nums">
            {title}
          </Text>
          {subtitle && (
            <Text size="xs" c="dimmed">
              {subtitle}
            </Text>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge color={COLORS[p.kind]} variant="light">
            {p.label}
          </Badge>
          <Text size="sm" fw={600} className="whitespace-nowrap tabular-nums">
            {formatEuros(i.totalInclTaxCents)}
          </Text>
        </div>
      </div>
      {p.detail && (
        <Text size="sm" c={p.kind === "rejected" ? "red" : "dimmed"}>
          {p.detail}
          {p.kind === "retrying" && ` Prochain essai : ${at.format(i.nextAttemptAt)}.`}
        </Text>
      )}
      {isDirector && (p.kind === "rejected" || p.kind === "issued_mismatch") && (
        <TextLink href="/parametres/entreprises" size="sm" className="self-start">
          Reprendre cette facture
        </TextLink>
      )}
      <ul aria-label="Lignes de la facture" className="flex flex-col text-sm">
        {i.lines.map((l) => (
          <li key={l.id} className="flex justify-between gap-3">
            <span className="min-w-0">{l.label}</span>
            <span className="whitespace-nowrap tabular-nums">{formatEuros(l.inclTaxCents)}</span>
          </li>
        ))}
      </ul>
      <Text size="xs" c="dimmed" className="tabular-nums">
        {i.installments.length === 0
          ? "Aucune échéance."
          : `Échéances : ${i.installments.map((d) => `${frenchDate(d.dueDate)} ${formatEuros(d.amountCents)}`).join(" · ")}`}
      </Text>
    </li>
  );
}

/**
 * A payer's invoices of the season (#352): one per business, where each stands on its way to
 * the business's invoicing tool, and « Préparer les factures » for the front desk and
 * management. Drafting again replaces the drafts not sent yet; an invoice sent or issued stays.
 */
export function InvoicesSection({
  payerId,
  season,
  invoices,
  showEntity,
  canDraft,
  endedNote,
  isDirector,
}: {
  payerId: string;
  season: { id: string; label: string };
  invoices: PayerInvoice[];
  showEntity: boolean;
  canDraft: boolean;
  /** An ended season shown on the record (#362): said instead of « Préparer les factures » (#380 open). */
  endedNote?: string;
  /** Management: a link to « Factures à reprendre » on a rejected invoice. */
  isDirector: boolean;
}) {
  const unsent = invoices.some(isUnsentDraft);
  return (
    <section aria-labelledby="factures" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Title order={2} size="h5" id="factures" tabIndex={-1}>
          Factures {season.label}
        </Title>
        {canDraft && !endedNote && <DraftInvoices payerId={payerId} seasonId={season.id} again={unsent} />}
      </div>
      {canDraft && endedNote && (
        <Text size="sm" c="dimmed">
          {endedNote}
        </Text>
      )}
      {invoices.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucune facture pour cette saison.
          {!endedNote &&
            " « Préparer les factures » en fait une par entreprise, à partir des inscriptions et des carnets pas encore facturés."}
        </Text>
      ) : (
        <Paper withBorder component="ul" className="divide-y divide-bordure">
          {invoices.map((i) => (
            <InvoiceCard key={i.id} i={i} showEntity={showEntity} isDirector={isDirector} />
          ))}
        </Paper>
      )}
    </section>
  );
}
