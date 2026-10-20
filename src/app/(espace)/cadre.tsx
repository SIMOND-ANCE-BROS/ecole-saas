"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

type Props = { volet: ReactNode; entete: ReactNode; children: ReactNode };

/**
 * Cadre de l'espace connecté. Sur ordinateur, la barre latérale est toujours
 * visible ; sur téléphone, elle se replie derrière un bouton « Menu » placé à
 * côté de la recherche, et se referme à chaque navigation ou avec Échap.
 */
export function Cadre({ volet, entete, children }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const chemin = usePathname();
  const [cheminOuvert, setCheminOuvert] = useState(chemin);
  if (ouvert && chemin !== cheminOuvert) setOuvert(false);

  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    window.addEventListener("keydown", fermer);
    return () => window.removeEventListener("keydown", fermer);
  }, [ouvert]);

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
        className={`${ouvert ? "fixed inset-0 z-40 flex overflow-y-auto" : "hidden"} shrink-0 flex-col gap-6 border-bordure bg-surface p-3 print:hidden md:sticky md:top-0 md:flex md:h-screen md:w-52 md:border-r`}
      >
        <button
          type="button"
          className="bouton-secondaire self-end md:hidden"
          onClick={() => setOuvert(false)}
        >
          Fermer
        </button>
        {volet}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-bordure bg-fond/90 px-3 py-2 backdrop-blur print:hidden md:px-4">
          <button
            type="button"
            className="bouton-secondaire shrink-0 md:hidden"
            aria-expanded={ouvert}
            aria-controls="volet"
            onClick={() => {
              setCheminOuvert(chemin);
              setOuvert(true);
            }}
          >
            Menu
          </button>
          {entete}
        </header>
        <main id="contenu" tabIndex={-1} className="w-full min-w-0 flex-1 p-3 sm:p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
