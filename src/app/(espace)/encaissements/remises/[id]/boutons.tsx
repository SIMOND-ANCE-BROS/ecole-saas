"use client";

import { useState, useTransition } from "react";
import { annuler } from "../../actions";

export function Imprimer() {
  return (
    <button type="button" className="bouton-principal" onClick={() => window.print()}>
      Imprimer le bordereau
    </button>
  );
}

/** Annulation d'une remise faite par erreur (direction), après confirmation. */
export function AnnulerRemise({ id }: { id: string }) {
  const [confirmer, setConfirmer] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();
  if (!confirmer) {
    return (
      <button type="button" className="lien text-sm text-erreur" onClick={() => setConfirmer(true)}>
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
        disabled={envoi}
        onClick={() => demarrer(async () => setMessage((await annuler(id)).message))}
      >
        Oui, annuler
      </button>
      <button type="button" className="lien" onClick={() => setConfirmer(false)}>
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
