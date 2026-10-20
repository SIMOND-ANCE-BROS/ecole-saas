"use client";

import { useState, useTransition } from "react";
import { deconnecterMonAgenda } from "./actions";

export function BoutonDeconnecter({ ecoleId, jeton }: { ecoleId: string; jeton: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  return (
    <>
      <button
        type="button"
        className="bouton-secondaire self-start"
        disabled={enCours}
        onClick={() => demarrer(async () => setMessage((await deconnecterMonAgenda(ecoleId, jeton)).message))}
      >
        Déconnecter mon agenda
      </button>
      {message && <p role="alert" className="text-erreur">{message}</p>}
    </>
  );
}
