"use client";

import { ActionIcon, Button, Fieldset, NativeSelect, Paper, Text, TextInput } from "@mantine/core";
import { useState, useTransition } from "react";
import { Cancel } from "@/app/(espace)/_panel/panel";
import { PAYMENT_METHODS, type Method } from "@/db/payments";
import { formatEuros, parseEuros } from "@/lib/money";
import { DateField, refusedDateField } from "../../_ui/date-field";
import { collectPayments } from "../actions";

type Row = { method: Method; amount: string; reference: string; issuer: string; payment: string };
const EMPTY_ROW: Row = { method: "cheque", amount: "", reference: "", issuer: "", payment: "" };
const METHOD_OPTIONS = Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }));

type Props = { payerId: string; payer: string; remaining: number | null; today: string; back: string };

/**
 * Payment from a payer (#97): one row per payment (three dated cheques,
 * a cheque and some cash…), a shared date received, total compared with
 * the amount still due.
 */
export function PaymentForm({ payerId: payerId, payer: payer, remaining: remaining, today: today, back: back }: Props) {
  const [rows, setRows] = useState<Row[]>([
    { ...EMPTY_ROW, amount: remaining && remaining > 0 ? (remaining / 100).toFixed(2).replace(".", ",") : "" },
  ]);
  const [date, setDate] = useState(today);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const updated = (i: number, v: Partial<Row>) => setRows(rows.map((l, j) => (j === i ? { ...l, ...v } : l)));
  const amounts = rows.map((l) => parseEuros(l.amount));
  const total = amounts.reduce<number>((s, m) => s + (m ?? 0), 0);
  const invalides = rows.map((l, i) => l.amount.trim() !== "" && (amounts[i] === null || amounts[i] === 0));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (refusedDateField(e.currentTarget)) return;
        if (!date) {
          setMessage("Indiquez la date de réception.");
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
        startTransition(async () => setMessage((await collectPayments(payerId, entry, back)).message));
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
          <Paper key={i} withBorder p="sm" className="grid gap-2 sm:grid-cols-[10rem_8rem_1fr_auto] sm:items-end">
            <NativeSelect
              label="Moyen"
              data={METHOD_OPTIONS}
              value={l.method}
              onChange={(e) => updated(i, { method: e.currentTarget.value as Method })}
            />
            <TextInput
              label="Montant (€)"
              // « Reçu le » is already today: the amount is what gets typed first.
              data-panel-focus={i === 0 || undefined}
              inputMode="decimal"
              styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
              value={l.amount}
              onChange={(e) => updated(i, { amount: e.currentTarget.value })}
              error={invalides[i] ? "Montant non reconnu" : undefined}
            />
            <TextInput
              label={l.method === "cheque" ? "N° de chèque" : "Référence (facultatif)"}
              value={l.reference}
              onChange={(e) => updated(i, { reference: e.currentTarget.value })}
            />
            {rows.length > 1 ? (
              <ActionIcon
                variant="default"
                size="input-sm"
                aria-label={`Retirer le règlement ${i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
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
                  onChange={(e) => updated(i, { issuer: e.currentTarget.value })}
                />
                <DateField
                  className="sm:col-span-2"
                  label="À encaisser le (vide : tout de suite)"
                  minDate={date || undefined}
                  value={l.payment}
                  onChange={(payment) => updated(i, { payment })}
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
          onClick={() =>
            setRows([
              ...rows,
              { ...EMPTY_ROW, method: rows.at(-1)?.method ?? "cheque", issuer: rows.at(-1)?.issuer ?? "" },
            ])
          }
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
      <div className="flex flex-wrap gap-2 border-t border-bordure pt-4">
        <Button type="submit" loading={sending} disabled={total === 0}>
          {`Encaisser ${formatEuros(total)}`}
        </Button>
        <Cancel href={back} />
      </div>
    </form>
  );
}
