"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LIENS = [
  { href: "/", libelle: "Accueil" },
  { href: "/personnes", libelle: "Personnes" },
  { href: "/planning", libelle: "Planning" },
  { href: "/intervenants", libelle: "Intervenants" },
];

/** Liens de la barre latérale ; la page courante est signalée (aria-current). */
export function Navigation() {
  const chemin = usePathname();
  const actif = (href: string) => (href === "/" ? chemin === "/" : chemin.startsWith(href));
  return (
    <nav aria-label="Navigation principale" className="flex flex-col gap-0.5">
      {LIENS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={actif(l.href) ? "page" : undefined}
          className="rounded-md border-l-[3px] border-transparent px-3 py-2.5 text-base md:py-1.5 md:text-sm text-doux hover:bg-accent-doux hover:text-texte focus-visible:outline-2 focus-visible:outline-accent aria-[current=page]:border-accent aria-[current=page]:bg-accent-doux aria-[current=page]:font-medium aria-[current=page]:text-texte"
        >
          {l.libelle}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Recherche de personnes accessible partout. Ctrl K (ou Cmd K) y place le
 * curseur ; sur la page Personnes, la liste se met à jour pendant la frappe ;
 * flèche bas pour descendre dans les résultats.
 */
export function RechercheGlobale() {
  const champ = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const chemin = usePathname();
  const parametres = useSearchParams();
  const surPersonnes = chemin === "/personnes";
  const [valeur, setValeur] = useState(surPersonnes ? (parametres.get("q") ?? "") : "");

  useEffect(() => {
    const raccourci = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        champ.current?.focus();
        champ.current?.select();
      }
    };
    window.addEventListener("keydown", raccourci);
    return () => window.removeEventListener("keydown", raccourci);
  }, []);

  const aller = (q: string, remplacer: boolean) => {
    const cible = q.trim() ? `/personnes?q=${encodeURIComponent(q.trim())}` : "/personnes";
    if (remplacer) router.replace(cible);
    else router.push(cible);
  };

  return (
    <form
      role="search"
      className="flex w-full max-w-xl items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        aller(valeur, surPersonnes);
      }}
    >
      <label htmlFor="recherche-globale" className="sr-only">
        Rechercher une personne
      </label>
      <input
        ref={champ}
        id="recherche-globale"
        type="search"
        autoComplete="off"
        placeholder="Rechercher : nom, prénom, téléphone…"
        className="champ w-full"
        value={valeur}
        autoFocus={surPersonnes}
        onChange={(e) => {
          setValeur(e.target.value);
          if (surPersonnes) aller(e.target.value, true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            const premier = document.querySelector<HTMLAnchorElement>("#resultats a[data-resultat]");
            if (premier) {
              e.preventDefault();
              premier.focus();
            }
          }
        }}
      />
      <kbd className="hidden shrink-0 rounded border border-bordure px-1.5 py-0.5 text-xs text-doux sm:inline">Ctrl K</kbd>
    </form>
  );
}
