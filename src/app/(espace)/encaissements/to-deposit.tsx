"use client";

import {
  Button,
  Checkbox,
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
import { useState, useTransition } from "react";
import { PAYMENT_METHODS } from "@/db/payments";
import type { AuditLogRow } from "@/db/deposits";
import type { DepositMethod } from "@/domain/payments/deposits";
import { formatEuros } from "@/lib/money";
import { DateField, refusedDateField } from "../_ui/date-field";
import { deposit } from "./actions";

const day = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Payments of one method to deposit (#98): all ticked by default; the bank deposit
 * takes the chosen date (today by default) and opens its deposit slip.
 */
export function ToDeposit({
  method: method,
  payments: payments,
  today: today,
}: {
  method: DepositMethod;
  payments: AuditLogRow[];
  today: string;
}) {
  const [chosen, setChosen] = useState(() => new Set(payments.map((p) => p.id)));
  const [date, setDate] = useState(today);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const selection = payments.filter((p) => chosen.has(p.id));
  const total = selection.reduce((s, p) => s + p.amountCents, 0);
  const toggle = (id: string) => {
    const s = new Set(chosen);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setChosen(s);
  };
  const title = PAYMENT_METHODS[method];

  return (
    <section aria-labelledby={`remettre-${method}`} className="flex flex-col gap-2">
      <Title order={2} size="h5" id={`remettre-${method}`}>
        {title}{" "}
        <Text span size="sm" c="dimmed">
          — {payments.length} à remettre
        </Text>
      </Title>
      <Paper withBorder className="overflow-x-auto">
        <Table highlightOnHover>
          <TableCaption className="sr-only">{title} à remettre</TableCaption>
          <TableThead>
            <TableTr>
              <TableTh w={40}>
                <Checkbox
                  aria-label={`Tout sélectionner (${title.toLowerCase()})`}
                  checked={chosen.size === payments.length}
                  indeterminate={chosen.size > 0 && chosen.size < payments.length}
                  onChange={(e) => setChosen(new Set(e.currentTarget.checked ? payments.map((p) => p.id) : []))}
                />
              </TableTh>
              <TableTh>Payeur</TableTh>
              {method !== "cash" && <TableTh>N°</TableTh>}
              {method === "cheque" && <TableTh>Banque ou titulaire</TableTh>}
              <TableTh>Reçu le</TableTh>
              {method === "cheque" && <TableTh>À encaisser le</TableTh>}
              <TableTh ta="right">Montant</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {payments.map((p) => (
              <TableTr key={p.id}>
                <TableTd>
                  <Checkbox
                    aria-label={`Remettre le paiement de ${p.payer}, ${formatEuros(p.amountCents)}`}
                    checked={chosen.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                </TableTd>
                <TableTd>{p.payer}</TableTd>
                {method !== "cash" && <TableTd>{p.reference ?? "—"}</TableTd>}
                {method === "cheque" && <TableTd>{p.issuer ?? "—"}</TableTd>}
                <TableTd className="whitespace-nowrap">{day(p.date)}</TableTd>
                {method === "cheque" && (
                  <TableTd className="whitespace-nowrap">{p.plannedPayment ? day(p.plannedPayment) : "—"}</TableTd>
                )}
                <TableTd ta="right" className="tabular-nums whitespace-nowrap">
                  {formatEuros(p.amountCents)}
                  {p.correctedCents > 0 && (
                    <Text component="span" size="xs" c="red" className="block">
                      dont {formatEuros(p.correctedCents)} corrigés
                    </Text>
                  )}
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </Paper>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (refusedDateField(e.currentTarget)) return;
          if (!date) {
            setMessage("Indiquez la date de la remise.");
            return;
          }
          setMessage(null);
          startTransition(async () =>
            setMessage((await deposit({ date, method: method, paymentIds: selection.map((p) => p.id) })).message),
          );
        }}
      >
        <DateField label="Date de la remise" required w={160} value={date} onChange={setDate} />
        <Button
          type="submit"
          loading={sending}
          disabled={selection.length === 0}
          aria-describedby={selection.length === 0 ? `${method}-nothing-ticked` : undefined}
        >
          {selection.length === 0
            ? "Créer la remise"
            : `Créer la remise : ${selection.length} × ${title.toLowerCase()}, ${formatEuros(total)}`}
        </Button>
        {/* Said in plain text: a disabled button's label is too faint to carry the instruction. */}
        {selection.length === 0 && (
          <Text id={`${method}-nothing-ticked`} size="sm" className="self-center">
            Cochez les paiements à remettre.
          </Text>
        )}
        {message && (
          <Text role="alert" size="sm" c="red">
            {message}
          </Text>
        )}
      </form>
    </section>
  );
}
