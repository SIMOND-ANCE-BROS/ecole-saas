"use client";

import { Kbd, NavLink, Text, TextInput } from "@mantine/core";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import type { Role } from "@/domain/team/rules";
import { FOCUS_SEARCH } from "./_ui/focus-search";

const LINKS = [
  { href: "/", label: "Accueil" },
  { href: "/eleves", label: "Élèves" },
  { href: "/contacts", label: "Contacts" },
  { href: "/planning", label: "Planning" },
  { href: "/encaissements", label: "Encaissements" },
  { href: "/intervenants", label: "Intervenants" },
  { href: "/parametres", label: "Paramètres" },
];

const NAV_LABEL = "Navigation principale";

/** Sidebar links; the current page is flagged (aria-current). */
export function Navigation({ role }: { role: Role }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav aria-label={NAV_LABEL} className="flex flex-col gap-0.5">
      {LINKS.filter(
        (l) =>
          (l.href !== "/parametres" || role === "director") &&
          (role !== "teacher" || !["/intervenants", "/eleves", "/contacts", "/encaissements"].includes(l.href)),
      ).map((l) => (
        <NavLink
          key={l.href}
          component={Link}
          href={l.href}
          label={l.label}
          active={active(l.href)}
          aria-current={active(l.href) ? "page" : undefined}
          className="rounded-md"
          // 44 px touch target on phones, compact with a mouse.
          py={{ base: 10, md: 6 }}
        />
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

  // On a list the cursor starts in the search (#140): set here rather than with `autoFocus`,
  // which the server renders from its own pathname and which would take focus from an open
  // panel. Only when nothing has the focus yet (reload, Back) or the sidebar link that led here.
  useEffect(() => {
    const active = document.activeElement;
    const free = !active || active === document.body || active.closest(`nav[aria-label="${NAV_LABEL}"]`) !== null;
    if (onList && free) field.current?.focus();
  }, [onList, path]);

  useEffect(() => {
    const focus = () => {
      field.current?.focus();
      field.current?.select();
    };
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    // A side panel closed by Ctrl K hands the focus over once it is gone (#244).
    window.addEventListener(FOCUS_SEARCH, focus);
    return () => {
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener(FOCUS_SEARCH, focus);
    };
  }, []);

  const go = (q: string, replace: boolean) => {
    let target = q.trim() ? `/eleves?q=${encodeURIComponent(q.trim())}` : "/eleves";
    if (onList) {
      const p = new URLSearchParams(settings.toString());
      if (q.trim()) p.set("q", q.trim());
      else p.delete("q");
      p.delete("page");
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
      <TextInput
        ref={field}
        aria-label={list?.label ?? "Rechercher un élève ou un parent"}
        className="w-full"
        id="recherche-globale"
        type="search"
        autoComplete="off"
        placeholder={list?.example ?? "Élève, parent, téléphone…"}
        defaultValue={search}
        onChange={(e) => {
          if (onList) go(e.currentTarget.value, true);
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
      <Text span id="etat-recherche" role="status" size="xs" c="dimmed" className="shrink-0">
        {inProgress ? "Recherche…" : ""}
      </Text>
      <Kbd className="hidden shrink-0 sm:inline-block">Ctrl K</Kbd>
    </form>
  );
}
