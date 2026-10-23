"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";

/** True inside a panel: « Annuler » goes back there instead of navigating. */
const InPanel = createContext(false);

type Props = { title: string; children: ReactNode };

/**
 * Side panel opened by an intercepted route (`@modal`): the original page
 * stays behind, the URL is the full page's. Closed by « Fermer », Escape,
 * a click outside or the Back button; focus returns to where it was.
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
  /** Element that had focus before opening (recorded once only: the effect may run again). */
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
          {/* Plain link: full reload, hence the whole page without a panel. */}
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

/** A form's « Annuler »: closes the panel, or leads to `href` as a full page. */
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
