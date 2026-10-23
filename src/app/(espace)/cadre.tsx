"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

type Props = { pane: ReactNode; header: ReactNode; children: ReactNode };

/**
 * Cadre de l'espace connecté. Sur ordinateur, la barre latérale est toujours
 * visible ; sur téléphone, elle se replie derrière un bouton « Menu » placé à
 * côté de la recherche, et se referme à chaque navigation ou avec Échap.
 */
export function Frame({ pane: pane, header: header, children }: Props) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const [openPath, setOpenPath] = useState(path);
  if (open && path !== openPath) setOpen(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
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
        <button type="button" className="bouton-secondaire self-end md:hidden" onClick={() => setOpen(false)}>
          Fermer
        </button>
        {pane}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-bordure bg-fond/90 px-3 py-2 backdrop-blur print:hidden md:px-4">
          <button
            type="button"
            className="bouton-secondaire shrink-0 md:hidden"
            aria-expanded={open}
            aria-controls="volet"
            onClick={() => {
              setOpenPath(path);
              setOpen(true);
            }}
          >
            Menu
          </button>
          {header}
        </header>
        <main id="contenu" tabIndex={-1} className="w-full min-w-0 flex-1 p-3 sm:p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
