"use client";

import {
  Anchor,
  Button,
  FocusTrap,
  Group,
  MantineThemeProvider,
  Overlay,
  Paper,
  Text,
  Title,
  type MantineThemeOverride,
} from "@mantine/core";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, use, useEffect, useId, useRef, useState } from "react";
import { elementOf, escapeCancels } from "../_ui/escape-cancels";
import { FOCUS_SEARCH } from "../_ui/focus-search";
import { useListReturn } from "../_ui/list-return";
import { useUnloadGuard, useUnsavedInput } from "../_ui/unsaved-input";

/** True inside a panel: « Annuler » goes back there instead of navigating. */
const InPanel = createContext(false);

/** Whether this is rendered inside a side panel (which guards its own input). */
export function useInPanel(): boolean {
  return use(InPanel);
}

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
 * a click outside or the Back button; focus returns to where it was. With
 * unsaved input, « Fermer », Escape, a click outside and « Ouvrir en pleine
 * page » ask « Abandonner la saisie ? » first (#251); a reload or closing the tab
 * gets the browser's own question (#258). The Back button does not ask: the
 * history has already moved when the router hears of it, and pushing it back is
 * fragile. A form's own « Annuler » does not either: it says what it does.
 * « Ouvrir en pleine page » keeps asking rather than carrying the input over: a
 * draft would put personal data (often a minor's) in browser storage.
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
  /**
   * Ctrl K closed the panel (#244): the modal dialog makes the page inert, so the
   * search can only take the focus once the panel is gone, as after Escape.
   */
  const toSearch = useRef(false);
  /** Last field or button focused in the panel: « Continuer la saisie » gives the focus back there. */
  const lastFocus = useRef<HTMLElement | null>(null);
  /** The panel is going away (Back called, or a full page loading): never ask, never go Back twice. */
  const closing = useRef(false);
  const [keepHint, setKeepHint] = useState(false);
  /**
   * Something typed or chosen is not saved (#251): a field differs from what the person saw,
   * or a value was picked in a list or calendar. A record without fields never holds input.
   */
  const holdsInput = useUnsavedInput(body, { touchRoot: dialogue, portal: `#${PORTAL_ID}` });
  // Reload, tab close or another address with input: the browser asks too (#258).
  useUnloadGuard(holdsInput, { leaving: closing });

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
      if (toSearch.current) window.dispatchEvent(new Event(FOCUS_SEARCH));
      else if (before.current?.isConnected) before.current.focus();
    };
  }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    router.back();
  };
  /** Leaving the panel while it holds input: what to do once « Abandonner » is chosen (#251). */
  const [leave, setLeave] = useState<(() => void) | null>(null);
  /** Escape, a click outside, « Fermer »: closes at once, or asks first when it holds input. */
  const requestLeave = (go: () => void) => (holdsInput() ? setLeave(() => go) : go());
  // The question takes the focus, on « Continuer la saisie »: also after the browser
  // closed and the panel reopened the dialog, which focuses its first element.
  useEffect(() => {
    if (!leave) return;
    const frame = requestAnimationFrame(() =>
      dialogue.current?.querySelector<HTMLElement>("[role=alertdialog] [data-autofocus]")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [leave]);
  const stay = () => {
    setLeave(null);
    const back = lastFocus.current;
    requestAnimationFrame(() => back?.isConnected && back.focus());
  };

  return (
    <dialog
      ref={dialogue}
      aria-label={title}
      className="panneau-lateral"
      onCancel={(e) => {
        e.preventDefault();
        if (leave) stay();
        else requestLeave(close);
      }}
      // Fallback: the browser may still close a modal dialog without a cancellable
      // « cancel » (a close request with no click since the last one). With input, reopen
      // it and ask; without, leave as Escape would.
      onClose={() => {
        const d = dialogue.current;
        if (closing.current || !d || d.open || !d.isConnected) return;
        if (holdsInput()) {
          d.showModal();
          setLeave(() => close);
        } else close();
      }}
      onClick={(e) => e.target === e.currentTarget && (leave ? stay() : requestLeave(close))}
      onKeyDownCapture={(e) => {
        // While « Abandonner la saisie ? » is asked, Escape answers « Continuer la saisie ».
        if (leave) {
          if (e.key === "Escape") {
            e.preventDefault();
            stay();
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") e.preventDefault();
          return;
        }
        if (e.key === "Escape") {
          // Escape with a list, calendar or menu open closes only that (Mantine does it): the
          // same check as the inline settings forms (#339), with the panel's own portal.
          const leaves = escapeCancels(e.key, false, elementOf(e.target), `#${PORTAL_ID}`);
          // Handled here rather than through « cancel »: a prevented keydown sends the browser
          // no close request, so it can never force the dialog shut without asking. Without
          // its default action, the dialog gets no « cancel » and stays open for the list.
          e.preventDefault();
          if (leaves) requestLeave(close);
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          // Held down or pressed twice: one Back only.
          if (toSearch.current || e.repeat) return;
          // Never lose what was typed (DESIGN.md): with input, the panel stays and says why.
          if (holdsInput()) {
            setKeepHint(true);
            return;
          }
          toSearch.current = true;
          close();
        }
      }}
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-bordure px-4 py-2">
          <div className="flex items-center justify-end gap-2">
            {/* Plain link: full reload, hence the whole page without a panel, and an empty form: it asks first too. */}
            <Anchor
              href={query ? `${path}?${query}` : path}
              size="sm"
              onClick={(e) => {
                // A new tab or window, or a download (Alt), leaves the panel as it is.
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !holdsInput()) return;
                e.preventDefault();
                const href = e.currentTarget.href;
                setLeave(() => () => {
                  closing.current = true;
                  window.location.assign(href);
                });
              }}
            >
              Ouvrir en pleine page
            </Anchor>
            <Button variant="default" onClick={() => requestLeave(close)}>
              Fermer
            </Button>
          </div>
          {/* On its own line, so it never squeezes the header's actions on a phone. */}
          <Text
            role="status"
            size="sm"
            bg="var(--mantine-color-blue-light)"
            // Mantine's light blue text is too pale on white (3.3:1): a darker shade in light mode.
            c="light-dark(var(--mantine-color-blue-9), var(--mantine-color-blue-light-color))"
            className="mt-2 rounded-md px-2 py-1 empty:hidden"
          >
            {keepHint ? "Enregistrez ou annulez avant de chercher." : ""}
          </Text>
        </div>
        <div
          ref={body}
          className="flex-1 overflow-y-auto overscroll-contain p-4"
          onFocusCapture={(e) => {
            if (e.target instanceof HTMLElement) lastFocus.current = e.target;
          }}
        >
          <MantineThemeProvider theme={IN_DIALOG}>
            <InPanel value>{children}</InPanel>
          </MantineThemeProvider>
        </div>
      </div>
      {/* Over the panel itself, not a portaled Modal: inside the top-layer dialog a fixed
          Modal is placed off the panel, and outside it the modal dialog would make it inert. */}
      {leave && (
        <ConfirmLeave
          onStay={stay}
          onLeave={() => {
            setLeave(null);
            leave();
          }}
        />
      )}
      {/* Lists, calendars and menus: every click there may pick a value (`useUnsavedInput`). */}
      <div id={PORTAL_ID} />
    </dialog>
  );
}

/**
 * « Abandonner la saisie ? » (#251), like the removal confirmations (#239): focus
 * starts on « Continuer la saisie », so Enter or Escape by reflex loses nothing.
 * Covers the panel; a click on its shade also means « continue ».
 */
function ConfirmLeave({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const titleId = useId();
  const textId = useId();
  return (
    <Overlay backgroundOpacity={0.35} center onClick={(e) => e.target === e.currentTarget && onStay()}>
      <FocusTrap active>
        <Paper
          role="alertdialog"
          aria-modal
          aria-labelledby={titleId}
          aria-describedby={textId}
          withBorder
          shadow="md"
          p="md"
          m="md"
          maw={420}
        >
          <Title order={2} size="h4" id={titleId}>
            Abandonner la saisie ?
          </Title>
          <Text size="sm" mt="xs" id={textId}>
            Ce qui a été tapé ou choisi dans ce panneau n’est pas enregistré.
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onStay} data-autofocus>
              Continuer la saisie
            </Button>
            <Button color="red" onClick={onLeave}>
              Abandonner
            </Button>
          </Group>
        </Paper>
      </FocusTrap>
    </Overlay>
  );
}

/** A form's « Annuler »: closes the panel, or leads to `href` as a full page. */
export function Cancel({ href }: { href: string }) {
  const router = useRouter();
  // A list keeps the filters and sort it had (#107).
  const target = useListReturn(href);
  if (use(InPanel)) {
    return (
      <Button variant="default" onClick={() => router.back()}>
        Annuler
      </Button>
    );
  }
  return (
    <Button component={Link} href={target} variant="default">
      Annuler
    </Button>
  );
}
