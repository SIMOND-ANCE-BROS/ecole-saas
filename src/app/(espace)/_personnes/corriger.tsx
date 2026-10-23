"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatEuros, parseEuros } from "@/lib/montant";
import { correct } from "../paiements/actions";

/**
 * Correction d'un paiement (direction) : un paiement ne se modifie pas, on
 * saisit un paiement négatif, au plus du montant encore non corrigé.
 */
export function CorrectPayment({
  paymentId: paymentId,
  remaining: remaining,
  back: back,
}: {
  paymentId: string;
  remaining: number;
  back: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((remaining / 100).toFixed(2).replace(".", ","));
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  if (!open) {
    return (
      <button type="button" className="lien text-xs" onClick={() => setOpen(true)}>
        Corriger
      </button>
    );
  }
  const cents = parseEuros(amount);
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (!cents) return;
        startTransition(async () => {
          const r = await correct(paymentId, cents, back);
          setMessage(r.message);
          if (!r.message) {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <label htmlFor={`correction-${paymentId}`}>Annuler</label>
      <input
        id={`correction-${paymentId}`}
        inputMode="decimal"
        className="champ w-24 text-right"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        autoFocus
      />
      <span className="text-doux">€ sur {formatEuros(remaining)}</span>
      <button type="submit" className="bouton-secondaire" disabled={sending || !cents || cents > remaining}>
        Enregistrer la correction
      </button>
      <button type="button" className="lien" onClick={() => setOpen(false)}>
        Fermer
      </button>
      {message && (
        <span role="alert" className="text-erreur">
          {message}
        </span>
      )}
    </form>
  );
}
