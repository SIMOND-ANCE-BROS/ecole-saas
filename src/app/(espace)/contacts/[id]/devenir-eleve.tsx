"use client";

import { useState, useTransition } from "react";
import { devenirEleve } from "../../eleves/actions";

/** Un parent qui prend aussi des cours : il rejoint la liste des élèves. */
export function DevenirEleve({ id, prenom }: { id: string; prenom: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  return (
    <>
      <button type="button" className="bouton-secondaire" disabled={enCours} onClick={() => demarrer(async () => setMessage((await devenirEleve(id)).message))}>
        {prenom} prend aussi des cours
      </button>
      {message && <p role="alert" className="text-sm text-erreur">{message}</p>}
    </>
  );
}
