"use client";

import { TextInput } from "@mantine/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/** Délai avant de relancer la recherche pendant la frappe. */
const DELAI = 300;

/**
 * Recherche d'une liste (#107) : les résultats suivent la frappe, sans bouton
 * à cliquer ; filtres et tri en cours sont gardés. Flèche bas : premier résultat.
 */
export function RechercheListe({ libelle, exemple }: { libelle: string; exemple: string }) {
  const router = useRouter();
  const chemin = usePathname();
  const params = useSearchParams();
  const [enCours, demarrer] = useTransition();
  const minuteur = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(minuteur.current), []);

  function chercher(q: string) {
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => {
      const p = new URLSearchParams(params.toString());
      if (q.trim()) p.set("q", q.trim());
      else p.delete("q");
      const texte = p.toString();
      demarrer(() => router.replace(texte ? `${chemin}?${texte}` : chemin, { scroll: false }));
    }, DELAI);
  }

  return (
    <TextInput
      type="search"
      aria-label={libelle}
      placeholder={exemple}
      defaultValue={params.get("q") ?? ""}
      onChange={(e) => chercher(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown") return;
        const premier = document.querySelector<HTMLAnchorElement>("#resultats a[data-resultat]");
        if (premier) {
          e.preventDefault();
          premier.focus();
        }
      }}
      rightSection={enCours ? <span className="text-xs text-doux">…</span> : null}
      size="md"
      className="w-full max-w-md"
      autoFocus
    />
  );
}
