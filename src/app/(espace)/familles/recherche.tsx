"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** Champ de recherche : met à jour l'adresse (?q=) après une courte pause de frappe. */
export function Recherche({ valeurInitiale }: { valeurInitiale: string }) {
  const router = useRouter();
  const [valeur, setValeur] = useState(valeurInitiale);
  const [enCours, demarrer] = useTransition();
  const premierRendu = useRef(true);

  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    const minuteur = setTimeout(() => {
      const q = valeur.trim();
      demarrer(() => router.replace(q ? `/familles?q=${encodeURIComponent(q)}` : "/familles"));
    }, 250);
    return () => clearTimeout(minuteur);
  }, [valeur, router]);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="recherche" className="text-sm font-medium">
        Rechercher une famille
      </label>
      <input
        id="recherche"
        type="search"
        autoFocus
        autoComplete="off"
        placeholder="Nom, prénom d’un danseur, téléphone, e-mail…"
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        className="champ w-96 max-w-full"
      />
      <span aria-live="polite" className="text-xs text-neutral-600 dark:text-neutral-400">
        {enCours ? "Recherche…" : ""}
      </span>
    </div>
  );
}
