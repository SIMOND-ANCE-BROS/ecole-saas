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
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";
import { FOCUS_SEARCH } from "../_ui/focus-search";
import { useListReturn } from "../_ui/list-return";

/** True inside a panel: « Annuler » goes back there instead of navigating. */
const InPanel = createContext(false);

type Props = { title: string; children: ReactNode };

/**
 * Field focused when a panel opens: the one a form marks with `data-panel-focus`,
 * else its first text field or list (not a radio or checkbox, such as « Particulier / Professionnel »).
 */
const FIRST_FIELD = "input:enabled:not([type=hidden],[type=radio],[type=checkbox]), select:enabled, textarea:enabled";

/** Keys that never change a value: moving between fields, closing, or a lone modifier. */
const NOT_AN_EDIT = new Set(["Tab", "Escape", "Shift", "Control", "Meta", "Alt", "AltGraph", "CapsLock"]);
/** Keys that move within a field: an edit only in a number field (they step its value). */
const MOVES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const NUMBER_FIELD = ".mantine-NumberInput-input";
/**
 * Controls whose click may change a value without typing: buttons (stepper, « Ajouter
 * un règlement », « Retirer »), boxes and radios. A click into a text field only places
 * the cursor; what is typed there counts through `input` events.
 */
const CONTROL =
  "button, select, input[type=checkbox], input[type=radio], [role=button], [role=option], [role=checkbox], [role=radio], [role=switch], [role=slider]";

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
 * page » ask « Abandonner la saisie ? » first (#251). The Back button does
 * not: the history has already moved when the router hears of it. A form's own
 * « Annuler » does not either: it says what it does.
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
  /** Something was typed or chosen in the panel: Ctrl K must not throw it away. */
  const edited = useRef(false);
  const [keepHint, setKeepHint] = useState(false);

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

  const close = () => router.back();
  const markEdited = () => {
    edited.current = true;
  };
  /** Leaving the panel while it holds input: what to do once « Abandonner » is chosen (#251). */
  const [leave, setLeave] = useState<(() => void) | null>(null);
  /** Escape, a click outside, « Fermer »: closes at once, or asks first when something was typed or chosen. */
  const requestLeave = (go: () => void) => (edited.current ? setLeave(() => go) : go());
  /** Where the focus was when the question came up: « Continuer la saisie » gives it back. */
  const beforeAsking = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (leave) beforeAsking.current ??= document.activeElement as HTMLElement | null;
  }, [leave]);
  const stay = () => {
    setLeave(null);
    const back = beforeAsking.current;
    beforeAsking.current = null;
    requestAnimationFrame(() => back?.isConnected && back.focus());
  };

  return (
    <dialog
      ref={dialogue}
      aria-label={title}
      className="panneau-lateral"
      onCancel={(e) => {
        e.preventDefault();
        requestLeave(close);
      }}
      // The browser may close a modal dialog without a cancellable « cancel » (a second
      // Escape with no click in between): reopen it, keep the input, and ask.
      onClose={() => {
        const d = dialogue.current;
        if (d && !d.open && d.isConnected) {
          d.showModal();
          requestLeave(close);
        }
      }}
      onClick={(e) => e.target === e.currentTarget && requestLeave(close)}
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
        // Escape with a list, calendar or menu open closes only that (Mantine does
        // it): without its default action, the dialog gets no « cancel » and stays
        // open. Open dropdowns are the visible children of the panel's portal
        // (Autocomplete sets no aria-expanded).
        const portal = document.getElementById(PORTAL_ID);
        const listOpen = [...(portal?.children ?? [])].some((c) => c.checkVisibility());
        if (e.key === "Escape" && listOpen) e.preventDefault();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          // Held down or pressed twice: one Back only.
          if (toSearch.current || e.repeat) return;
          // Never lose what was typed (DESIGN.md): with input, the panel stays and says why.
          if (edited.current) {
            setKeepHint(true);
            return;
          }
          toSearch.current = true;
          close();
        } else if (NOT_AN_EDIT.has(e.key)) {
          // Moving between fields or closing changes nothing.
        } else if (MOVES.has(e.key)) {
          // Arrows move the cursor in a text field, but step a number field.
          if (e.target instanceof Element && e.target.matches(NUMBER_FIELD)) edited.current = true;
        } else {
          // Any other key may change a value (typing, Enter on an option or on « Ajouter »,
          // Space on a box): a false « edited » only shows the hint, a false « untouched » loses data.
          edited.current = true;
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
                if (!edited.current || e.ctrlKey || e.metaKey || e.shiftKey) return;
                e.preventDefault();
                const href = e.currentTarget.href;
                requestLeave(() => window.location.assign(href));
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
          // Typing, ticking, choosing a radio: the form now holds unsaved input.
          onInputCapture={markEdited}
          onChangeCapture={markEdited}
          // A click on a control may change a value without an input event (stepper,
          // adding a row, a Select option or calendar day rendered in the portal below).
          onPointerDownCapture={(e) => {
            if (e.target instanceof Element && e.target.closest(CONTROL)) markEdited();
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
      {/* Every click in an open list, calendar or menu may pick a value. */}
      <div id={PORTAL_ID} onPointerDownCapture={markEdited} />
    </dialog>
  );
}

/**
 * « Abandonner la saisie ? » (#251), like the removal confirmations (#239): focus
 * starts on « Continuer la saisie », so Enter or Escape by reflex loses nothing.
 * Covers the panel; a click on its shade also means « continue ».
 */
function ConfirmLeave({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  return (
    <Overlay backgroundOpacity={0.35} center onClick={(e) => e.target === e.currentTarget && onStay()}>
      <FocusTrap active>
        <Paper
          role="alertdialog"
          aria-modal
          aria-labelledby="leave-panel-title"
          aria-describedby="leave-panel-text"
          withBorder
          shadow="md"
          p="md"
          m="md"
          maw={420}
        >
          <Title order={2} size="h4" id="leave-panel-title">
            Abandonner la saisie ?
          </Title>
          <Text size="sm" mt="xs" id="leave-panel-text">
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
