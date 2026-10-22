"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formaterEuros, lireEuros } from "@/lib/montant";
import { corriger } from "../paiements/actions";

/**
 * Correction d'un paiement (direction) : un paiement ne se modifie pas, on
 * saisit un paiement négatif, au plus du montant encore non corrigé.
 */
export function CorrigerPaiement({
  paiementId,
  restant,
  retour,
}: {
  paiementId: string;
  restant: number;
  retour: string;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [montant, setMontant] = useState((restant / 100).toFixed(2).replace(".", ","));
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();
  if (!ouvert) {
    return (
      <button type="button" className="lien text-xs" onClick={() => setOuvert(true)}>
        Corriger
      </button>
    );
  }
  const centimes = lireEuros(montant);
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (!centimes) return;
        demarrer(async () => {
          const r = await corriger(paiementId, centimes, retour);
          setMessage(r.message);
          if (!r.message) {
            setOuvert(false);
            router.refresh();
          }
        });
      }}
    >
      <label htmlFor={`correction-${paiementId}`}>Annuler</label>
      <input
        id={`correction-${paiementId}`}
        inputMode="decimal"
        className="champ w-24 text-right"
        value={montant}
        onChange={(e) => setMontant(e.target.value)}
        autoFocus
      />
      <span className="text-doux">€ sur {formaterEuros(restant)}</span>
      <button type="submit" className="bouton-secondaire" disabled={envoi || !centimes || centimes > restant}>
        Enregistrer la correction
      </button>
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
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
