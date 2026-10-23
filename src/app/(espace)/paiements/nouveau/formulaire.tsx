"use client";

import { useState, useTransition } from "react";
import { Cancel } from "@/app/(espace)/_panneau/panneau";
import { MOYENS, type Method } from "@/db/paiements";
import { formatEuros, parseEuros } from "@/lib/montant";
import { collectPayments } from "../actions";

type Row = { method: Method; amount: string; reference: string; issuer: string; payment: string };
const EMPTY_ROW: Row = { method: "cheque", amount: "", reference: "", issuer: "", payment: "" };

type Props = { payerId: string; payer: string; remaining: number | null; today: string; back: string };

/**
 * Encaissement d'un payeur (#97) : une ligne par règlement (trois chèques
 * datés, un chèque et des espèces…), date de réception commune, total
 * comparé au reste à payer.
 */
export function PaymentForm({ payerId: payerId, payer: payer, remaining: remaining, today: today, back: back }: Props) {
  const [rows, setRows] = useState<Row[]>([
    { ...EMPTY_ROW, amount: remaining && remaining > 0 ? (remaining / 100).toFixed(2).replace(".", ",") : "" },
  ]);
  const [date, setDate] = useState(today);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const updated = (i: number, v: Partial<Row>) => setRows(rows.map((l, j) => (j === i ? { ...l, ...v } : l)));
  const montants = rows.map((l) => parseEuros(l.amount));
  const total = montants.reduce<number>((s, m) => s + (m ?? 0), 0);
  const invalides = rows.map((l, i) => l.amount.trim() !== "" && (montants[i] === null || montants[i] === 0));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (montants.some((m) => !m)) {
          setMessage("Indiquez un montant pour chaque règlement.");
          return;
        }
        const saisie = rows.map((l, i) => ({
          method: l.method,
          amountCents: montants[i],
          date,
          reference: l.reference,
          issuer: l.issuer,
          plannedPayment: l.method === "cheque" && l.payment ? l.payment : null,
        }));
        setMessage(null);
        startTransition(async () => setMessage((await collectPayments(payerId, saisie, back)).message));
      }}
    >
      <p className="text-sm">
        Payeur : <strong>{payer}</strong>
        {remaining !== null && (
          <span className="text-doux">
            {" "}
            —{" "}
            {remaining > 0
              ? `reste à payer ${formatEuros(remaining)}`
              : remaining < 0
                ? `trop-perçu ${formatEuros(-remaining)}`
                : "à jour"}
          </span>
        )}
      </p>
      <div className="flex flex-col gap-1 sm:max-w-xs">
        <label htmlFor="date-reception" className="text-sm font-medium">
          Reçu le
        </label>
        <input
          id="date-reception"
          type="date"
          className="champ"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Règlements</legend>
        {rows.map((l, i) => (
          <div key={i} className="panneau grid gap-2 p-3 sm:grid-cols-[10rem_8rem_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1">
              <label htmlFor={`moyen-${i}`} className="text-xs text-doux">
                Moyen
              </label>
              <select
                id={`moyen-${i}`}
                className="champ"
                value={l.method}
                onChange={(e) => updated(i, { method: e.target.value as Method })}
              >
                {Object.entries(MOYENS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`montant-${i}`} className="text-xs text-doux">
                Montant (€)
              </label>
              <input
                id={`montant-${i}`}
                inputMode="decimal"
                className="champ text-right tabular-nums"
                value={l.amount}
                onChange={(e) => updated(i, { amount: e.target.value })}
                aria-invalid={invalides[i] || undefined}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`reference-${i}`} className="text-xs text-doux">
                {l.method === "cheque" ? "N° de chèque" : "Référence (facultatif)"}
              </label>
              <input
                id={`reference-${i}`}
                className="champ"
                value={l.reference}
                onChange={(e) => updated(i, { reference: e.target.value })}
              />
            </div>
            {rows.length > 1 ? (
              <button
                type="button"
                className="bouton-secondaire px-2"
                aria-label={`Retirer le règlement ${i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                ×
              </button>
            ) : (
              <span />
            )}
            {l.method === "cheque" && (
              <>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label htmlFor={`emetteur-${i}`} className="text-xs text-doux">
                    Banque ou titulaire (facultatif)
                  </label>
                  <input
                    id={`emetteur-${i}`}
                    className="champ"
                    value={l.issuer}
                    onChange={(e) => updated(i, { issuer: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label htmlFor={`encaissement-${i}`} className="text-xs text-doux">
                    À encaisser le (vide : tout de suite)
                  </label>
                  <input
                    id={`encaissement-${i}`}
                    type="date"
                    min={date}
                    className="champ"
                    value={l.payment}
                    onChange={(e) => updated(i, { payment: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
        ))}
        <button
          type="button"
          className="lien self-start text-sm"
          disabled={rows.length >= 24}
          onClick={() =>
            setRows([
              ...rows,
              { ...EMPTY_ROW, method: rows.at(-1)?.method ?? "cheque", issuer: rows.at(-1)?.issuer ?? "" },
            ])
          }
        >
          Ajouter un règlement
        </button>
      </fieldset>

      <p className="text-sm" aria-live="polite">
        Total : <strong className="tabular-nums">{formatEuros(total)}</strong>
        {remaining !== null && remaining > 0 && total !== remaining && (
          <span className="text-doux"> (reste à payer : {formatEuros(remaining)})</span>
        )}
      </p>
      {message && (
        <p role="alert" className="text-sm text-erreur">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-t border-bordure pt-4">
        <button type="submit" className="bouton-principal" disabled={sending || total === 0}>
          {sending ? "Enregistrement…" : `Encaisser ${formatEuros(total)}`}
        </button>
        <Cancel href={back} />
      </div>
    </form>
  );
}
