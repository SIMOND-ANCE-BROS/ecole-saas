"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

const LIENS = [
  { href: "/", libelle: "Accueil" },
  { href: "/eleves", libelle: "Élèves" },
  { href: "/contacts", libelle: "Contacts" },
  { href: "/planning", libelle: "Planning" },
  { href: "/encaissements", libelle: "Encaissements" },
  { href: "/intervenants", libelle: "Intervenants" },
  { href: "/parametres", libelle: "Paramètres" },
];

/** Liens de la barre latérale ; la page courante est signalée (aria-current). */
export function Navigation({ role }: { role: "direction" | "accueil" | "professeur" }) {
  const chemin = usePathname();
  const actif = (href: string) => (href === "/" ? chemin === "/" : chemin.startsWith(href));
  return (
    <nav aria-label="Navigation principale" className="flex flex-col gap-0.5">
      {LIENS.filter(
        (l) =>
          (l.href !== "/parametres" || role === "direction") &&
          (role !== "professeur" || !["/intervenants", "/eleves", "/contacts", "/encaissements"].includes(l.href)),
      ).map((l) => (
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

/** Listes où la recherche du haut cherche sur place, avec le texte d’aide du champ. */
const LISTES: Record<string, { libelle: string; exemple: string }> = {
  "/eleves": { libelle: "Rechercher un élève ou un parent", exemple: "Élève, parent, téléphone…" },
  "/contacts": { libelle: "Rechercher un contact", exemple: "Contact, téléphone, e-mail…" },
  "/intervenants": { libelle: "Rechercher un intervenant", exemple: "Nom ou e-mail de l’intervenant…" },
};

/**
 * La seule recherche de l’application (#107), accessible partout ; Ctrl K (ou
 * Cmd K) y place le curseur. Sur une liste (élèves, contacts, intervenants),
 * elle filtre cette liste pendant la frappe, en gardant filtres de colonnes
 * et tri ; ailleurs, Entrée mène aux élèves (et aux contacts liés). Flèche bas
 * pour descendre dans les résultats.
 */
export function RechercheGlobale() {
  const champ = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const chemin = usePathname();
  const parametres = useSearchParams();
  const liste = LISTES[chemin];
  const surListe = liste !== undefined;
  const recherche = surListe ? (parametres.get("q") ?? "") : "";
  const [enCours, naviguer] = useTransition();

  // L’URL redevient la référence une fois la navigation terminée, y compris
  // après Précédent/Suivant. Ne pas écraser la frappe pendant une transition.
  useEffect(() => {
    if (!enCours && champ.current && champ.current.value.trim() !== recherche) champ.current.value = recherche;
  }, [recherche, chemin, enCours]);

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
    let cible = q.trim() ? `/eleves?q=${encodeURIComponent(q.trim())}` : "/eleves";
    if (surListe) {
      const p = new URLSearchParams(parametres.toString());
      if (q.trim()) p.set("q", q.trim());
      else p.delete("q");
      cible = p.size ? `${chemin}?${p}` : chemin;
    }
    naviguer(() => {
      if (remplacer) router.replace(cible, { scroll: false });
      else router.push(cible);
    });
  };

  return (
    <form
      role="search"
      className="flex w-full max-w-xl items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        aller(champ.current?.value ?? "", surListe);
      }}
    >
      <label htmlFor="recherche-globale" className="sr-only">
        {liste?.libelle ?? "Rechercher un élève ou un parent"}
      </label>
      <input
        ref={champ}
        id="recherche-globale"
        type="search"
        autoComplete="off"
        placeholder={liste?.exemple ?? "Élève, parent, téléphone…"}
        className="champ w-full"
        defaultValue={recherche}
        aria-describedby="etat-recherche"
        autoFocus={surListe}
        onChange={(e) => {
          if (surListe) aller(e.target.value, true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !enCours) {
            const premier = document.querySelector<HTMLAnchorElement>("#resultats a[data-resultat]");
            if (premier) {
              e.preventDefault();
              premier.focus();
            }
          }
        }}
      />
      <span id="etat-recherche" role="status" className="shrink-0 text-xs text-doux">
        {enCours ? "Recherche…" : ""}
      </span>
      <kbd className="hidden shrink-0 rounded border border-bordure px-1.5 py-0.5 text-xs text-doux sm:inline">
        Ctrl K
      </kbd>
    </form>
  );
}
