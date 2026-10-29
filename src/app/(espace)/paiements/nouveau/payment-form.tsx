"use client";

import { ActionIcon, Button, Fieldset, NativeSelect, Paper, Text, TextInput } from "@mantine/core";
import { useEffect, useRef, useState, useTransition } from "react";
import { Cancel } from "@/app/(espace)/_panel/panel";
import { PAYMENT_METHODS, type Method } from "@/db/payments";
import { formatEuros, parseEuros, typedEuros } from "@/lib/money";
import { DateField, refusedDateField } from "../../_ui/date-field";
import { collectPayments } from "../actions";
import { orConnectionLost } from "@/lib/action-result";
import { CheckSaved } from "@/app/(espace)/_ui/check-saved";

/** `id`: stable key of the row, so removing one keeps the others' fields in place. */
type Row = { id: number; method: Method; amount: string; reference: string; issuer: string; payment: string };
const EMPTY_ROW: Omit<Row, "id"> = { method: "cheque", amount: "", reference: "", issuer: "", payment: "" };
const METHOD_OPTIONS = Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }));

type Props = { payerId: string; payer: string; remaining: number | null; today: string; back: string };

/**
 * Payment from a payer (#97): one row per payment (three dated cheques,
 * a cheque and some cash…), a shared date received, total compared with
 * the amount still due.
 */
export function PaymentForm({ payerId: payerId, payer: payer, remaining: remaining, today: today, back: back }: Props) {
  const [rows, setRows] = useState<Row[]>([
    { ...EMPTY_ROW, id: 0, amount: remaining && remaining > 0 ? typedEuros(remaining) : "" },
  ]);
  const nextId = useRef(1);
  // Row added with « Ajouter un règlement »: its amount gets the focus once rendered.
  const added = useRef<number | null>(null);
  // Cheque dates are compared with « Reçu le » once a save was tried.
  const [checked, setChecked] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const [date, setDate] = useState(today);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const updated = (id: number, v: Partial<Row>) => setRows(rows.map((l) => (l.id === id ? { ...l, ...v } : l)));
  const amounts = rows.map((l) => parseEuros(l.amount));
  const total = amounts.reduce<number>((s, m) => s + (m ?? 0), 0);
  const invalides = rows.map((l, i) => l.amount.trim() !== "" && (amounts[i] === null || amounts[i] === 0));
  // A cheque to cash before it was received: the calendar bound only checks typed text.
  const early = (l: Row) => l.method === "cheque" && l.payment !== "" && date !== "" && l.payment < date;

  useEffect(() => {
    if (added.current === null) return;
    form.current?.querySelector<HTMLElement>(`[data-row-amount="${added.current}"]`)?.focus();
    added.current = null;
  }, [rows]);

  return (
    <form
      ref={form}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (refusedDateField(e.currentTarget)) return;
        if (!date) {
          setMessage("Indiquez la date de réception.");
          return;
        }
        setChecked(true);
        const late = rows.find(early);
        if (late) {
          setMessage(null);
          const field = e.currentTarget.querySelector<HTMLInputElement>(`[data-row-payment="${late.id}"]`);
          // The message under the field stays visible: no calendar on this focus.
          if (field) field.dataset.quietFocus = "1";
          field?.focus();
          return;
        }
        if (amounts.some((m) => !m)) {
          setMessage("Indiquez un montant pour chaque règlement.");
          return;
        }
        const entry = rows.map((l, i) => ({
          method: l.method,
          amountCents: amounts[i],
          date,
          reference: l.reference,
          issuer: l.issuer,
          plannedPayment: l.method === "cheque" && l.payment ? l.payment : null,
        }));
        setMessage(null);
        startTransition(async () =>
          setMessage(
            (
              await orConnectionLost(
                () => collectPayments(payerId, entry, back),
                (message) => ({ message }),
              )
            ).message,
          ),
        );
      }}
    >
      <Text size="sm">
        Payeur : <strong>{payer}</strong>
        {remaining !== null && (
          <Text span size="sm" c="dimmed">
            {" "}
            —{" "}
            {remaining > 0
              ? `reste à payer ${formatEuros(remaining)}`
              : remaining < 0
                ? `trop-perçu ${formatEuros(-remaining)}`
                : "à jour"}
          </Text>
        )}
      </Text>
      <DateField label="Reçu le" required w={160} value={date} onChange={setDate} />

      <Fieldset
        legend={
          <Text component="span" size="sm" fw={600}>
            Règlements
          </Text>
        }
        variant="unstyled"
        className="flex flex-col gap-3"
      >
        {rows.map((l, i) => (
          // Aligned on the top of the fields: a message under one field does not shift the others.
          <Paper key={l.id} withBorder p="sm" className="grid gap-2 sm:grid-cols-[10rem_8rem_1fr_auto] sm:items-start">
            <NativeSelect
              label="Moyen"
              data={METHOD_OPTIONS}
              value={l.method}
              onChange={(e) => updated(l.id, { method: e.currentTarget.value as Method })}
            />
            <TextInput
              label="Montant (€)"
              // « Reçu le » is already today: the amount is what gets typed first.
              data-panel-focus={i === 0 || undefined}
              // Full page too (the panel focuses `data-panel-focus` itself).
              autoFocus={i === 0}
              data-row-amount={l.id}
              inputMode="decimal"
              styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
              value={l.amount}
              onChange={(e) => updated(l.id, { amount: e.currentTarget.value })}
              error={invalides[i] ? "Montant non reconnu" : undefined}
            />
            <TextInput
              label={l.method === "cheque" ? "N° de chèque" : "Référence (facultatif)"}
              value={l.reference}
              onChange={(e) => updated(l.id, { reference: e.currentTarget.value })}
            />
            {rows.length > 1 ? (
              <ActionIcon
                variant="default"
                size="input-sm"
                // Level with the inputs, below the labels of the row.
                className="sm:mt-[22px]"
                aria-label={`Retirer le règlement ${i + 1}`}
                onClick={() => setRows(rows.filter((r) => r.id !== l.id))}
              >
                ×
              </ActionIcon>
            ) : (
              <span />
            )}
            {l.method === "cheque" && (
              <>
                <TextInput
                  className="sm:col-span-2"
                  label="Banque ou titulaire (facultatif)"
                  value={l.issuer}
                  onChange={(e) => updated(l.id, { issuer: e.currentTarget.value })}
                />
                <DateField
                  className="sm:col-span-2"
                  label="À encaisser le (vide : tout de suite)"
                  minDate={date || undefined}
                  value={l.payment}
                  onChange={(payment) => updated(l.id, { payment })}
                  error={checked && early(l) ? "Pas avant la date de réception" : undefined}
                  data-row-payment={l.id}
                />
              </>
            )}
          </Paper>
        ))}
        <Button
          variant="subtle"
          size="compact-sm"
          className="self-start"
          disabled={rows.length >= 24}
          onClick={() => {
            const id = nextId.current++;
            setRows([
              ...rows,
              { ...EMPTY_ROW, id, method: rows.at(-1)?.method ?? "cheque", issuer: rows.at(-1)?.issuer ?? "" },
            ]);
            added.current = id;
          }}
        >
          Ajouter un règlement
        </Button>
      </Fieldset>

      <Text size="sm" aria-live="polite">
        Total : <strong className="tabular-nums">{formatEuros(total)}</strong>
        {remaining !== null && remaining > 0 && total !== remaining && (
          <Text span size="sm" c="dimmed">
            {" "}
            (reste à payer : {formatEuros(remaining)})
          </Text>
        )}
      </Text>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      <CheckSaved message={message} href={back} label="Voir les paiements de la fiche" />
      <div className="flex flex-wrap gap-2 border-t border-bordure pt-4">
        {/* An unreadable amount is left out of the total: no « Encaisser » for a wrong sum. */}
        <Button type="submit" loading={sending} disabled={total === 0 || invalides.some(Boolean)}>
          {`Encaisser ${formatEuros(total)}`}
        </Button>
        <Cancel href={back} />
      </div>
    </form>
  );
}
