"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, use, useEffect, useRef } from "react";

/** Vrai à l'intérieur d'un panneau : « Annuler » y revient en arrière au lieu de naviguer. */
const DansPanneau = createContext(false);

type Props = { titre: string; children: ReactNode };

/**
 * Panneau latéral ouvert par une route interceptée (`@modal`) : la page
 * d'origine reste derrière, l'adresse est celle de la page complète. Se ferme
 * par « Fermer », Échap, un clic à côté ou le bouton Retour ; le focus revient
 * là où il était.
 */
export function Panneau({ titre, children }: Props) {
  const router = useRouter();
  const chemin = usePathname();
  const dialogue = useRef<HTMLDialogElement>(null);
  /** Élément qui avait le focus avant l'ouverture (noté une seule fois : l'effet peut être rejoué). */
  const avant = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) {
      avant.current = document.activeElement as HTMLElement | null;
      d.showModal();
    }
    return () => {
      if (avant.current?.isConnected) avant.current.focus();
    };
  }, []);

  const fermer = () => router.back();

  return (
    <dialog
      ref={dialogue}
      aria-label={titre}
      className="panneau-lateral"
      onCancel={(e) => {
        e.preventDefault();
        fermer();
      }}
      onClick={(e) => e.target === e.currentTarget && fermer()}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-end gap-2 border-b border-bordure px-4 py-2">
          {/* Lien classique : rechargement complet, donc la page entière sans panneau. */}
          <a href={chemin} className="lien text-sm">
            Ouvrir en pleine page
          </a>
          <button type="button" className="bouton-secondaire" onClick={fermer}>
            Fermer
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          <DansPanneau value>{children}</DansPanneau>
        </div>
      </div>
    </dialog>
  );
}

/** « Annuler » d'un formulaire : ferme le panneau, ou mène à `href` en pleine page. */
export function Annuler({ href }: { href: string }) {
  const router = useRouter();
  if (use(DansPanneau)) {
    return (
      <button type="button" className="bouton-secondaire" onClick={() => router.back()}>
        Annuler
      </button>
    );
  }
  return (
    <Link href={href} className="bouton-secondaire">
      Annuler
    </Link>
  );
}
