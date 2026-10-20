"use client";

import type { KeyboardEvent, ReactNode } from "react";

/**
 * Rend une liste de résultats navigable au clavier : flèches haut et bas pour
 * passer d'un lien `[data-resultat]` à l'autre, Entrée pour l'ouvrir.
 */
export function ResultatsNavigables({ children }: { children: ReactNode }) {
  const deplacer = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const liens = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-resultat]")];
    const position = liens.indexOf(document.activeElement as HTMLAnchorElement);
    const suivant = e.key === "ArrowDown" ? Math.min(position + 1, liens.length - 1) : Math.max(position - 1, 0);
    if (liens[suivant]) {
      e.preventDefault();
      liens[suivant].focus();
    }
  };
  return (
    <div id="resultats" onKeyDown={deplacer}>
      {children}
    </div>
  );
}
