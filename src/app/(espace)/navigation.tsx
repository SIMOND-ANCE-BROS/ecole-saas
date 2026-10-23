"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import type { Role } from "@/domain/team/rules";

const LIENS = [
  { href: "/", label: "Accueil" },
  { href: "/eleves", label: "Élèves" },
  { href: "/contacts", label: "Contacts" },
  { href: "/planning", label: "Planning" },
  { href: "/encaissements", label: "Encaissements" },
  { href: "/intervenants", label: "Intervenants" },
  { href: "/parametres", label: "Paramètres" },
];

/** Sidebar links; the current page is flagged (aria-current). */
export function Navigation({ role }: { role: Role }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav aria-label="Navigation principale" className="flex flex-col gap-0.5">
      {LIENS.filter(
        (l) =>
          (l.href !== "/parametres" || role === "director") &&
          (role !== "teacher" || !["/intervenants", "/eleves", "/contacts", "/encaissements"].includes(l.href)),
      ).map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className="rounded-md border-l-[3px] border-transparent px-3 py-2.5 text-base md:py-1.5 md:text-sm text-doux hover:bg-accent-doux hover:text-texte focus-visible:outline-2 focus-visible:outline-accent aria-[current=page]:border-accent aria-[current=page]:bg-accent-doux aria-[current=page]:font-medium aria-[current=page]:text-texte"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** Lists where the top search filters in place, with the field's help text. */
const LISTS: Record<string, { label: string; example: string }> = {
  "/eleves": { label: "Rechercher un élève ou un parent", example: "Élève, parent, téléphone…" },
  "/contacts": { label: "Rechercher un contact", example: "Contact, téléphone, e-mail…" },
  "/intervenants": { label: "Rechercher un intervenant", example: "Nom ou e-mail de l’intervenant…" },
};

/**
 * The application's only search (#107), available everywhere; Ctrl K (or
 * Cmd K) puts the cursor in it. On a list (students, contacts, instructors),
 * it filters that list while typing, keeping column filters and sort;
 * elsewhere, Enter leads to the students (and related contacts). Down arrow
 * to move into the results.
 */
export function GlobalSearch() {
  const field = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const path = usePathname();
  const settings = useSearchParams();
  const list = LISTS[path];
  const onList = list !== undefined;
  const search = onList ? (settings.get("q") ?? "") : "";
  const [inProgress, navigate] = useTransition();

  // The URL becomes the reference again once navigation is over, including
  // after Back/Forward. Don't overwrite typing during a transition.
  useEffect(() => {
    if (!inProgress && field.current && field.current.value.trim() !== search) field.current.value = search;
  }, [search, path, inProgress]);

  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const go = (q: string, replace: boolean) => {
    let target = q.trim() ? `/eleves?q=${encodeURIComponent(q.trim())}` : "/eleves";
    if (onList) {
      const p = new URLSearchParams(settings.toString());
      if (q.trim()) p.set("q", q.trim());
      else p.delete("q");
      target = p.size ? `${path}?${p}` : path;
    }
    navigate(() => {
      if (replace) router.replace(target, { scroll: false });
      else router.push(target);
    });
  };

  return (
    <form
      role="search"
      className="flex w-full max-w-xl items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        go(field.current?.value ?? "", onList);
      }}
    >
      <label htmlFor="recherche-globale" className="sr-only">
        {list?.label ?? "Rechercher un élève ou un parent"}
      </label>
      <input
        ref={field}
        id="recherche-globale"
        type="search"
        autoComplete="off"
        placeholder={list?.example ?? "Élève, parent, téléphone…"}
        className="champ w-full"
        defaultValue={search}
        aria-describedby="etat-recherche"
        autoFocus={onList}
        onChange={(e) => {
          if (onList) go(e.target.value, true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !inProgress) {
            const first = document.querySelector<HTMLAnchorElement>("#resultats a[data-resultat]");
            if (first) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      />
      <span id="etat-recherche" role="status" className="shrink-0 text-xs text-doux">
        {inProgress ? "Recherche…" : ""}
      </span>
      <kbd className="hidden shrink-0 rounded border border-bordure px-1.5 py-0.5 text-xs text-doux sm:inline">
        Ctrl K
      </kbd>
    </form>
  );
}
