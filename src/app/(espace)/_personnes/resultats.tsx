"use client";

import type { KeyboardEvent, ReactNode } from "react";

/**
 * Rend une liste de résultats navigable au clavier : flèches haut et bas pour
 * passer d'un lien `[data-resultat]` à l'autre, Entrée pour l'ouvrir.
 */
export function NavigableResults({ children }: { children: ReactNode }) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const relationships = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-resultat]")];
    const position = relationships.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === "ArrowDown" ? Math.min(position + 1, relationships.length - 1) : Math.max(position - 1, 0);
    if (relationships[next]) {
      e.preventDefault();
      relationships[next].focus();
    }
  };
  return (
    <div id="resultats" onKeyDown={move}>
      {children}
    </div>
  );
}
