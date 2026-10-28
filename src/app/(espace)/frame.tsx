"use client";

import { Button } from "@mantine/core";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

type Props = { pane: ReactNode; header: ReactNode; children: ReactNode };

/**
 * Frame of the signed-in workspace. On desktop, the sidebar is always
 * visible; on phones, it folds behind a « Menu » button next to the search,
 * and closes on every navigation or with Escape.
 */
export function Frame({ pane: pane, header: header, children }: Props) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const [openPath, setOpenPath] = useState(path);
  const menu = useRef<HTMLButtonElement>(null);
  if (open && path !== openPath) setOpen(false);
  // Closed by « Fermer » or Escape: focus goes back to « Menu », not to the page top.
  const close = () => {
    setOpen(false);
    menu.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      menu.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <a
        href="#contenu"
        className="fixed top-3 left-3 z-50 -translate-y-[200%] rounded-md border border-accent bg-surface p-3 text-accent focus:translate-y-0"
      >
        Aller au contenu
      </a>
      <aside
        id="volet"
        className={`${open ? "fixed inset-0 z-40 flex overflow-y-auto" : "hidden"} shrink-0 flex-col gap-6 border-bordure bg-surface p-3 print:hidden md:sticky md:top-0 md:flex md:h-screen md:w-52 md:border-r`}
      >
        <Button variant="default" className="self-end md:hidden" onClick={close}>
          Fermer
        </Button>
        {pane}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-bordure bg-fond/90 px-3 py-2 backdrop-blur print:hidden md:px-4">
          <Button
            ref={menu}
            variant="default"
            className="shrink-0 md:hidden"
            aria-expanded={open}
            aria-controls="volet"
            onClick={() => {
              setOpenPath(path);
              setOpen(true);
            }}
          >
            Menu
          </Button>
          {header}
        </header>
        <main id="contenu" tabIndex={-1} className="w-full min-w-0 flex-1 p-3 sm:p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
