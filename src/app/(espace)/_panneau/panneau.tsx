"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";

/** Vrai à l'intérieur d'un panneau : « Annuler » y revient en arrière au lieu de naviguer. */
const InPanel = createContext(false);

type Props = { title: string; children: ReactNode };

/**
 * Panneau latéral ouvert par une route interceptée (`@modal`) : la page
 * d'origine reste derrière, l'adresse est celle de la page complète. Se ferme
 * par « Fermer », Échap, un clic à côté ou le bouton Retour ; le focus revient
 * là où il était.
 *
 * A parallel slot keeps its content on a client navigation to a route it does
 * not intercept (redirect after saving, link): the panel hides itself once the
 * pathname differs from the one it opened on. No catch-all slot page, which
 * strict route matching would apply to pages outside `(espace)` (#135).
 * Relies on `cacheComponents` being off: with it, a hidden segment stays mounted
 * in `<Activity>` and an open modal dialog would keep the page inert.
 */
export function Panel(props: Props) {
  const path = usePathname();
  const [openedOn] = useState(path);
  return path === openedOn ? <PanelDialog {...props} path={path} /> : null;
}

function PanelDialog({ title, children, path }: Props & { path: string }) {
  const router = useRouter();
  const dialogue = useRef<HTMLDialogElement>(null);
  /** Élément qui avait le focus avant l'ouverture (noté une seule fois : l'effet peut être rejoué). */
  const before = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) {
      before.current = document.activeElement as HTMLElement | null;
      d.showModal();
    }
    return () => {
      if (before.current?.isConnected) before.current.focus();
    };
  }, []);

  const close = () => router.back();

  return (
    <dialog
      ref={dialogue}
      aria-label={title}
      className="panneau-lateral"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-end gap-2 border-b border-bordure px-4 py-2">
          {/* Lien classique : rechargement complet, donc la page entière sans panneau. */}
          <a href={path} className="lien text-sm">
            Ouvrir en pleine page
          </a>
          <button type="button" className="bouton-secondaire" onClick={close}>
            Fermer
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          <InPanel value>{children}</InPanel>
        </div>
      </div>
    </dialog>
  );
}

/** « Annuler » d'un formulaire : ferme le panneau, ou mène à `href` en pleine page. */
export function Cancel({ href }: { href: string }) {
  const router = useRouter();
  if (use(InPanel)) {
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
