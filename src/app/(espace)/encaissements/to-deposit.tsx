"use client";

import { useState, useTransition } from "react";
import { PAYMENT_METHODS } from "@/db/payments";
import type { AuditLogRow } from "@/db/deposits";
import type { DepositMethod } from "@/domain/payments/deposits";
import { formatEuros } from "@/lib/money";
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
      <h2 id={`remettre-${method}`} className="text-base font-semibold">
        {title} <span className="text-sm font-normal text-doux">— {payments.length} à remettre</span>
      </h2>
      <div className="panneau overflow-x-auto">
        <table className="tableau">
          <caption className="sr-only">{title} à remettre</caption>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label={`Tout sélectionner (${title.toLowerCase()})`}
                  checked={chosen.size === payments.length}
                  onChange={(e) => setChosen(new Set(e.target.checked ? payments.map((p) => p.id) : []))}
                />
              </th>
              <th>Payeur</th>
              {method !== "cash" && <th>N°</th>}
              {method === "cheque" && <th>Banque ou titulaire</th>}
              <th>Reçu le</th>
              {method === "cheque" && <th>À encaisser le</th>}
              <th className="text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Remettre le paiement de ${p.payer}, ${formatEuros(p.amountCents)}`}
                    checked={chosen.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                </td>
                <td>{p.payer}</td>
                {method !== "cash" && <td>{p.reference ?? "—"}</td>}
                {method === "cheque" && <td>{p.issuer ?? "—"}</td>}
                <td className="whitespace-nowrap">{day(p.date)}</td>
                {method === "cheque" && (
                  <td className="whitespace-nowrap">{p.plannedPayment ? day(p.plannedPayment) : "—"}</td>
                )}
                <td className="text-right tabular-nums whitespace-nowrap">
                  {formatEuros(p.amountCents)}
                  {p.correctedCents > 0 && (
                    <span className="block text-xs text-alerte-texte">
                      dont {formatEuros(p.correctedCents)} corrigés
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          startTransition(async () =>
            setMessage((await deposit({ date, method: method, paymentIds: selection.map((p) => p.id) })).message),
          );
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`date-remise-${method}`} className="text-xs text-doux">
            Date de la remise
          </label>
          <input
            id={`date-remise-${method}`}
            type="date"
            className="champ"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="bouton-principal" disabled={sending || selection.length === 0}>
          {sending
            ? "Création…"
            : `Créer la remise : ${selection.length} × ${title.toLowerCase()}, ${formatEuros(total)}`}
        </button>
        {message && (
          <p role="alert" className="text-sm text-erreur">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
