"use client";

import { Button, MantineThemeProvider, type MantineThemeOverride } from "@mantine/core";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";

/** True inside a panel: « Annuler » goes back there instead of navigating. */
const InPanel = createContext(false);

type Props = { title: string; children: ReactNode };

/**
 * Field focused when a panel opens: the one a form marks with `data-panel-focus`,
 * else its first text field or list (not a radio or checkbox, such as « Particulier / Professionnel »).
 */
const FIRST_FIELD = "input:enabled:not([type=hidden],[type=radio],[type=checkbox]), select:enabled, textarea:enabled";

/** Where the panel's drop-down lists, calendars and menus are rendered. */
const PORTAL_ID = "panneau-portail";
/**
 * The dialog is in the top layer: a Mantine dropdown portaled to `<body>`
 * (the default) would sit behind it, out of reach. Inside the panel, every
 * `Portal` (Select, Autocomplete, DateInput, Menu…) renders into the dialog.
 */
const IN_DIALOG: MantineThemeOverride = {
  components: { Portal: { defaultProps: { target: `#${PORTAL_ID}` } } },
};

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
  // The panel's own parameters (« ?payeur= », « ?jour= »): the full page needs them too.
  const query = useSearchParams().toString();
  const dialogue = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  /** Element that had focus before opening (recorded once only: the effect may run again). */
  const before = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) {
      before.current = document.activeElement as HTMLElement | null;
      d.showModal();
      // showModal() focuses the first focusable element, « Ouvrir en pleine page »:
      // a form opens on its first field instead, ready to type.
      const field =
        body.current?.querySelector<HTMLElement>("[data-panel-focus]") ??
        body.current?.querySelector<HTMLElement>(FIRST_FIELD);
      field?.focus();
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
      onKeyDownCapture={(e) => {
        // Escape with a list, calendar or menu open closes only that (Mantine does
        // it): without its default action, the dialog gets no « cancel » and stays
        // open. Open dropdowns are the visible children of the panel's portal
        // (Autocomplete sets no aria-expanded).
        const portal = document.getElementById(PORTAL_ID);
        const listOpen = [...(portal?.children ?? [])].some((c) => c.checkVisibility());
        if (e.key === "Escape" && listOpen) e.preventDefault();
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-end gap-2 border-b border-bordure px-4 py-2">
          {/* Plain link: full reload, hence the whole page without a panel. */}
          <a href={query ? `${path}?${query}` : path} className="lien text-sm">
            Ouvrir en pleine page
          </a>
          <button type="button" className="bouton-secondaire" onClick={close}>
            Fermer
          </button>
        </div>
        <div ref={body} className="flex-1 overflow-y-auto overscroll-contain p-4">
          <MantineThemeProvider theme={IN_DIALOG}>
            <InPanel value>{children}</InPanel>
          </MantineThemeProvider>
        </div>
      </div>
      <div id={PORTAL_ID} />
    </dialog>
  );
}

/** A form's « Annuler »: closes the panel, or leads to `href` as a full page. */
export function Cancel({ href }: { href: string }) {
  const router = useRouter();
  if (use(InPanel)) {
    return (
      <Button variant="default" onClick={() => router.back()}>
        Annuler
      </Button>
    );
  }
  return (
    <Button component={Link} href={href} variant="default">
      Annuler
    </Button>
  );
}
