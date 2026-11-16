import { Badge, Paper, Text, Title } from "@mantine/core";
import { toolAvailable } from "@/connectors/invoicing/connector";
import type { OfferedPlans } from "@/db/installment-plans";
import type { PayerInvoice } from "@/db/payer-invoices";
import { type Connection, invoiceProgress, isUnsentDraft, type ProgressKind } from "@/domain/invoicing/progress";
import { TextLink } from "../_ui/text-link";
import { frenchDate } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { planLabel } from "@/domain/invoicing/plans";
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
          : `Échéances${i.installmentCount === null ? "" : ` (${planLabel(i.installmentCount)})`} : ${i.installments
              // A date and its amount never split across two lines.
              .map((d) => `${frenchDate(d.dueDate)}\u00a0${formatEuros(d.amountCents)}`)
              .join(" · ")}`}
      </Text>
    </li>
  );
}

/**
 * A payer's invoices of the season (#352): one per business, where each stands on its way to
 * the business's invoicing tool, and « Préparer les factures » for the front desk and
 * management, one button per plan that fits (#176). Drafting again replaces the drafts not
 * sent yet; an invoice sent or issued stays.
 */
export function InvoicesSection({
  payerId,
  season,
  invoices,
  showEntity,
  canDraft,
  endedNote,
  isDirector,
  plans,
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
  /** The school's plans for this season (#176). */
  plans: OfferedPlans | null;
}) {
  const unsent = invoices.filter(isUnsentDraft);
  const current = unsent.find((i) => i.installmentCount !== null)?.installmentCount ?? null;
  const drafting = canDraft && !endedNote && plans !== null;
  return (
    <section aria-labelledby="factures" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Title order={2} size="h5" id="factures" tabIndex={-1}>
          Factures {season.label}
        </Title>
        {drafting && (
          <DraftInvoices
            payerId={payerId}
            seasonId={season.id}
            again={unsent.length > 0}
            counts={plans?.counts ?? []}
            current={current}
          />
        )}
      </div>
      {drafting && plans && <PlanNote plans={plans} current={current} />}
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

/**
 * When what is billed falls due (#176, #436): « Forfaits à l’année : échéances le 5 du mois,
 * la première le 05/09/2027, la dernière au plus tard le 30/06/2028. », then the quarters, the
 * packs and drop-ins paid at once, the plan chosen, and the plans the season no longer fits.
 */
function PlanNote({ plans, current }: { plans: OfferedPlans; current: number | null }) {
  const chosen = current === null ? "" : ` Choix actuel : ${planLabel(current)}.`;
  if (plans.noneLeft)
    return (
      <Text size="xs" c="dimmed">
        {`Plus aucune échéance possible dans la saison : sauf forfaits au trimestre, la facture est due en une fois, à la date du jour.${chosen}`}
      </Text>
    );
  const tooLong = plans.tooLong.map(planLabel);
  const day = plans.dueDay === 1 ? "1er" : plans.dueDay;
  return (
    <Text size="xs" c="dimmed">
      {`Forfaits à l’année : échéances le ${day} du mois, la première le ${frenchDate(plans.firstDue)}, la dernière au plus tard le ${frenchDate(plans.seasonEnd)}. Forfaits au trimestre : à chaque trimestre. Carnets et cours à l’unité : en une fois, le ${frenchDate(plans.oneOffDue)}.${chosen}`}
      {tooLong.length > 0 &&
        ` Le paiement ${tooLong.join(" ou ")} n’est plus possible : la dernière échéance tomberait après la fin de la saison.`}
      {plans.counts.length === 0 &&
        " Aucun plan proposé ne tient dans la saison : la direction peut proposer « en une fois » dans Paramètres › Paiement en plusieurs fois."}
    </Text>
  );
}
