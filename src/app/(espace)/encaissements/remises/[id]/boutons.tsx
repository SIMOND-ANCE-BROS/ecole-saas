"use client";

import { useState, useTransition } from "react";
import { cancel } from "../../actions";

export function Print() {
  return (
    <button type="button" className="bouton-principal" onClick={() => window.print()}>
      Imprimer le bordereau
    </button>
  );
}

/** Annulation d'une remise faite par erreur (direction), après confirmation. */
export function CancelDeposit({ id }: { id: string }) {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  if (!confirm) {
    return (
      <button type="button" className="lien text-sm text-erreur" onClick={() => setConfirm(true)}>
        Annuler la remise
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      Annuler cette remise ? Ses paiements redeviendront à remettre.
      <button
        type="button"
        className="bouton-secondaire"
        disabled={sending}
        onClick={() => startTransition(async () => setMessage((await cancel(id)).message))}
      >
        Oui, annuler
      </button>
      <button type="button" className="lien" onClick={() => setConfirm(false)}>
        Non
      </button>
      {message && (
        <span role="alert" className="text-erreur">
          {message}
        </span>
      )}
    </span>
  );
}
