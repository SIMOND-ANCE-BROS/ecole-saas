"use client";

import type { KeyboardEvent, ReactNode } from "react";

/**
 * Makes a result list keyboard-navigable: up and down arrows move from one
 * `[data-resultat]` link to the next, Enter opens it.
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
