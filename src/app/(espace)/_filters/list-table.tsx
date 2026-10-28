"use client";

import {
  ActionIcon,
  Anchor,
  Button,
  Checkbox,
  CloseButton,
  Loader,
  Pagination,
  Paper,
  Table,
  Text,
  TextInput,
  UnstyledButton,
  type ButtonProps,
} from "@mantine/core";
import Link from "next/link";
import { unstable_rethrow, usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, use, useId, useRef, useState, useTransition } from "react";
import {
  writeColumnFilter,
  type ColumnFilter,
  readColumnFilter,
  columnFilterSummary,
} from "@/domain/filters/column-filter";
import type { List } from "@/domain/filters/columns";
import {
  toggle,
  type Layout,
  move,
  defaultLayout,
  writeLayout,
  readLayout,
  place,
  resize,
} from "@/domain/filters/layout";
import { type ColumnDef, conditionLabel, readSort, type Sort, EMPTY } from "@/domain/filters/filters";
import { pageCount, shownRange } from "@/domain/filters/pagination";
import { todayInParis } from "@/domain/people/age";
import { DateField } from "../_ui/date-field";
import { saveColumns } from "./actions";
import { type AddressFilter, useAddressFilter } from "./address-filter";

export type CellValue = string | number | string[] | null;
/** A cell's own link; `label` names it for screen readers when the text alone is a bare date. */
export type CellLink = { href: string; label?: string };
/** `Id`: the list column ids, so a cell keyed by a wrong id fails to compile (#138). */
export type TableRow<Id extends string = string> = {
  id: string;
  /** Record link for the column named by `linkColumn`; absent: plain text. */
  href?: string;
  /** Greyed-out row (inactive instructor…). */
  dimmed?: boolean;
  /** Small badge after the name (« inactif », « organisme »). */
  badge?: string;
  cells: Record<Id, CellValue>;
  /** A cell's own link, other than the record (« Remise » → its deposit slip). */
  links?: Partial<Record<Id, CellLink>>;
};

type Props<Id extends string> = {
  list: List;
  /** End of the columns popover title, with its article: « des élèves ». */
  what: string;
  caption: string;
  columns: readonly ColumnDef<Id>[];
  /** The member's saved layout, or null. */
  layout: string[] | null;
  rows: TableRow<NoInfer<Id>>[];
  /** Column carrying the link to the record. */
  linkColumn: NoInfer<Id>;
  /** Message when no row is shown. */
  empty: string;
  /** Phone-specific display (the table is hidden there). */
  mobile?: ReactNode;
  /** Checkbox values supplied by the page, per column (courses of the season, statuses…). */
  choice?: Partial<Record<NoInfer<Id>, readonly string[]>>;
  /** Action offered when the list is empty without a filter (« Nouvel élève »). */
  emptyAction?: ReactNode;
  /**
   * Page shown and rows matching, all pages together (#107); absent: a single page.
   * `noun` starts the counter (« Élèves 51 à 100 sur 134 »), the caption by default.
   */
  pagination?: { page: number; total: number; noun?: string };
};

/** Beyond this, the checkbox list gets its own search field. */
const CELLS_WITHOUT_SEARCH = 8;

/**
 * Table list (#89, #107), designed for the front desk and close to Excel:
 * each column header opens a menu to sort and filter (checkboxes,
 * « de … à … », « contient »). The sort direction and filtered columns
 * show on the headers; active filters are repeated as pills.
 * The whole row opens the record. The « Colonnes » menu shows, hides and
 * reorders columns (saved for the member). Filters and sort go into the URL;
 * the page reads it back and queries the server.
 */
export function ListTable<Id extends string>({
  list,
  what,
  caption,
  columns,
  layout,
  rows,
  linkColumn,
  empty,
  mobile,
  choice: choice = {},
  emptyAction,
  pagination,
}: Props<Id>) {
  const f = useAddressFilter(columns);
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [sortPending, startSort] = useTransition();
  const currentSort = readSort(params.get("sort"), params.get("order"), columns);
  const [availability, setAvailability] = useState<Layout>(() => readLayout(columns, layout));
  // Its own state, not a transition: an aborted action can leave a transition pending for good.
  const [saving, setSaving] = useState(false);
  // Only the latest save speaks: an older one finishing late must not overwrite its result.
  const lastSave = useRef(0);
  // Why the last layout save failed, or null; the list keeps the layout shown either way (#212).
  const [failure, setFailure] = useState<{ message: string; retryable: boolean } | null>(null);
  const columnsMenu = useRef<HTMLSpanElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const defs = new Map<string, ColumnDef<Id>>(columns.map((c) => [c.id, c]));
  const visible = availability.filter((d) => d.visible).flatMap((d) => defs.get(d.id) ?? []);
  const masquees = availability.filter((d) => !d.visible).flatMap((d) => defs.get(d.id) ?? []);
  const widthOf = (id: string) => availability.find((d) => d.id === id)?.width ?? null;
  const style = (id: string) => {
    const l = widthOf(id);
    return l ? { width: l, minWidth: l, maxWidth: l } : undefined;
  };
  const choiceOf = (d: ColumnDef<Id>) => choice[d.id] ?? d.choice;

  function setSort(next: Sort | null) {
    const p = new URLSearchParams(params.toString());
    p.delete("sort");
    p.delete("order");
    p.delete("page");
    if (next) {
      p.set("sort", next.column);
      p.set("order", next.direction);
    }
    const text = p.toString();
    startSort(() => router.replace(text ? `${path}?${text}` : path, { scroll: false }));
  }

  /** Another page: a new history entry (browser back returns to the previous page). */
  function goToPage(page: number) {
    const p = new URLSearchParams(params.toString());
    if (page > 1) p.set("page", String(page));
    else p.delete("page");
    const text = p.toString();
    startSort(() => router.push(text ? `${path}?${text}` : path));
  }

  // Width from the keyboard (header menu): the column's current width, measured, plus or minus a step.
  const thead = useRef<HTMLTableSectionElement>(null);
  function nudgeWidth(id: string, step: number) {
    const th = thead.current?.querySelector<HTMLElement>(`[data-col="${id}"]`);
    const current = widthOf(id) ?? th?.getBoundingClientRect().width;
    if (current) changeAvailability(resize(availability, id, current + step));
  }

  /** Click on a row: opens the record, except on a link or a button, or during a text selection. */
  function open(e: React.MouseEvent<HTMLTableRowElement>, href: string | undefined) {
    if (!href || (e.target as HTMLElement).closest("a, button, input, select") || window.getSelection()?.toString())
      return;
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank");
    else router.push(href);
  }

  function changeAvailability(d: Layout) {
    setAvailability(d);
    void saveLayout(d);
  }

  /** Saves the layout; every outcome (saved, refused, failed, no answer) clears « Enregistrement… ». */
  async function saveLayout(d: Layout) {
    const id = ++lastSave.current;
    setSaving(true);
    // A rejected call (network down, aborted request) must not reach the error boundary and take
    // the list away; one that never answers counts as failed after SAVE_TIMEOUT.
    try {
      const saved = await withTimeout(saveColumns(list, writeLayout(d)), SAVE_TIMEOUT);
      if (id !== lastSave.current) return;
      if (saved.ok) {
        // Retried from « Réessayer », which now goes away: focus back on « Colonnes ».
        if (document.activeElement === retryButton.current) columnsMenu.current?.querySelector("button")?.focus();
        setFailure(null);
      } else setFailure({ message: saved.message, retryable: saved.retryable });
    } catch (e) {
      // A redirect thrown by the action is Next's to handle.
      unstable_rethrow(e);
      // Without a session cookie the proxy answers the action with the sign-in page, which fails
      // like a network error: an expired session goes to sign-in, without the message.
      if (await sessionExpired()) return router.push("/connexion");
      if (id === lastSave.current)
        setFailure({ message: "Colonnes non enregistrées : vérifiez la connexion et réessayez.", retryable: true });
    } finally {
      if (id === lastSave.current) setSaving(false);
    }
  }

  // Drag and drop of a header (mouse); with the keyboard, the arrows of the « Colonnes » menu.
  const [dragged, setDragged] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Width: drag a header's right edge; saved on release, double-click for automatic width.
  // During this gesture, the (draggable) header must not start a drag and drop.
  const resizing = useRef(false);
  function startResize(e: React.PointerEvent<HTMLElement>, id: string) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    const th = e.currentTarget.parentElement as HTMLElement;
    const origin = e.clientX;
    const initial = th.getBoundingClientRect().width;
    let current = availability;
    const trackPointer = (ev: PointerEvent) => {
      current = resize(availability, id, initial + ev.clientX - origin);
      setAvailability(current);
    };
    const release = () => {
      resizing.current = false;
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("pointerup", release);
      if (current !== availability) changeAvailability(current);
    };
    window.addEventListener("pointermove", trackPointer);
    window.addEventListener("pointerup", release);
  }

  // Pills for active filters, hidden columns included.
  const pills = columns.flatMap((d) => {
    const fc = readColumnFilter(f.filter, d);
    const summary = columnFilterSummary(d, fc);
    const keep = (other: ColumnFilter["otherConditions"]) =>
      f.change(writeColumnFilter(f.filter, d, { otherConditions: other }));
    return [
      ...(summary ? [{ key: d.id, text: summary, remove: () => keep(fc.otherConditions) }] : []),
      ...fc.otherConditions
        .filter((c) => f.complete(c))
        .map((c, i) => ({
          key: `${d.id}-${i}`,
          text: conditionLabel(c, columns),
          remove: () =>
            f.change(
              writeColumnFilter(f.filter, d, { ...fc, otherConditions: fc.otherConditions.filter((x) => x !== c) }),
            ),
        })),
    ];
  });
  const filter = pills.length > 0;
  const clearAll = () => f.change({ mode: "et", conditions: [] });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
        {filter ? (
          <>
            <ul className="flex flex-wrap gap-1.5" aria-label="Filtres actifs">
              {pills.map((p) => (
                <li
                  key={p.key}
                  className="flex items-center gap-1 rounded-full border border-accent bg-accent-doux py-0.5 pr-1 pl-2.5"
                >
                  {p.text}
                  <CloseButton size="sm" radius="xl" aria-label={`Retirer le filtre ${p.text}`} onClick={p.remove} />
                </li>
              ))}
            </ul>
            <Anchor component="button" type="button" size="sm" onClick={clearAll}>
              Effacer les filtres
            </Anchor>
          </>
        ) : (
          <Text span size="sm" c="dimmed" className={mobile ? "hidden sm:inline" : ""}>
            Cliquez sur le titre d’une colonne pour trier ou filtrer.
          </Text>
        )}
        <span className="flex items-center gap-2 sm:ml-auto">
          <Text
            span
            size="xs"
            c={failure && !saving ? "red" : "dimmed"}
            role="status"
            className="inline-flex items-center gap-1"
          >
            {f.inProgress || sortPending ? (
              "Mise à jour…"
            ) : saving ? (
              "Enregistrement des colonnes…"
            ) : failure ? (
              <>
                <AlertIcon />
                {failure.message}
              </>
            ) : (
              ""
            )}
          </Text>
          {/* Stays rendered and enabled while saving (`loading` would disable it and drop the focus). */}
          {failure?.retryable && (
            <Button
              ref={retryButton}
              size="compact-xs"
              variant="subtle"
              aria-disabled={saving || undefined}
              leftSection={saving ? <Loader size={10} /> : null}
              onClick={() => {
                if (!saving) changeAvailability(availability);
              }}
            >
              Réessayer
            </Button>
          )}
          {/* On phones, cards: no columns to adjust. */}
          <span ref={columnsMenu} className={mobile ? "hidden sm:inline" : ""}>
            <Popover
              title={`Colonnes ${what}`}
              button={masquees.length ? `Colonnes (${masquees.length} de plus)` : "Colonnes"}
              buttonProps={{ variant: "default" }}
              width="w-[22rem]"
            >
              <ColumnsMenu
                columns={defs}
                availability={availability}
                change={changeAvailability}
                byDefault={() => changeAvailability(defaultLayout(columns))}
              />
            </Popover>
          </span>
        </span>
      </div>

      {mobile && <div className="sm:hidden">{mobile}</div>}
      <Paper withBorder className={`overflow-x-auto ${mobile ? "hidden sm:block" : ""}`}>
        <Table verticalSpacing={5}>
          <caption className="sr-only">{caption}</caption>
          <Table.Thead ref={thead}>
            <Table.Tr>
              {visible.map((d) => (
                <Table.Th
                  key={d.id}
                  data-col={d.id}
                  scope="col"
                  aria-sort={
                    currentSort?.column === d.id
                      ? currentSort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  draggable
                  onMouseDown={(e) => {
                    // A width handle is grabbed: no native drag and drop.
                    if ((e.target as HTMLElement).dataset.poignee) e.preventDefault();
                  }}
                  style={style(d.id)}
                  className={`relative select-none ${dragged === d.id ? "opacity-50" : ""} ${hovered === d.id && dragged !== d.id ? "shadow-[inset_3px_0_0_var(--accent)]" : ""}`}
                  onDragStart={(e) => {
                    if (resizing.current) return e.preventDefault();
                    setDragged(d.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", d.id);
                  }}
                  onDragOver={(e) => {
                    if (!dragged) return;
                    e.preventDefault();
                    setHovered(d.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragged) changeAvailability(place(availability, dragged, d.id));
                    setDragged(null);
                    setHovered(null);
                  }}
                  onDragEnd={() => {
                    setDragged(null);
                    setHovered(null);
                  }}
                >
                  <TitleMenu
                    def={d}
                    choice={choiceOf(d)}
                    f={f}
                    currentSort={currentSort?.column === d.id ? currentSort.direction : null}
                    sort={(direction) => setSort(direction ? { column: d.id, direction } : null)}
                    hide={
                      visible.length > 1 && !d.required ? () => changeAvailability(toggle(availability, d.id)) : null
                    }
                    width={{
                      narrower: () => nudgeWidth(d.id, -WIDTH_STEP),
                      wider: () => nudgeWidth(d.id, WIDTH_STEP),
                      automatic: widthOf(d.id) ? () => changeAvailability(resize(availability, d.id, null)) : null,
                    }}
                  />
                  <span
                    aria-hidden
                    data-poignee="1"
                    title="Tirez pour changer la largeur, double-cliquez pour la largeur automatique"
                    className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-accent/40"
                    onPointerDown={(e) => startResize(e, d.id)}
                    onDoubleClick={() => changeAvailability(resize(availability, d.id, null))}
                  />
                </Table.Th>
              ))}
              <Table.Th scope="col" className="w-8 px-1 text-right">
                <Popover
                  title="Ajouter une colonne"
                  buttonLabel="Ajouter une colonne"
                  button="+"
                  plainClass="rounded px-2 py-0.5 text-base leading-none text-accent hover:bg-accent-doux"
                >
                  <Text size="sm" fw={500} mb="xs">
                    Ajouter une colonne
                  </Text>
                  {masquees.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      Toutes les colonnes sont affichées.
                    </Text>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {masquees.map((c) => (
                        <li key={c.id}>
                          <Anchor
                            component="button"
                            type="button"
                            size="sm"
                            onClick={() => changeAvailability(place(toggle(availability, c.id), c.id, null))}
                          >
                            {c.label}
                          </Anchor>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Text size="xs" c="dimmed" mt="xs">
                    Pour retirer une colonne : cliquez sur son titre, puis « Masquer la colonne ».
                  </Text>
                </Popover>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={visible.length + 1} className="py-6 text-center">
                  <Text size="sm" c="dimmed">
                    {empty}
                  </Text>
                  <div className="mt-3 flex justify-center gap-3">
                    {filter ? (
                      <Button variant="default" onClick={clearAll}>
                        Effacer les filtres
                      </Button>
                    ) : (
                      emptyAction
                    )}
                  </div>
                </Table.Td>
              </Table.Tr>
            ) : (
              rows.map((l) => (
                <Table.Tr
                  key={l.id}
                  c={l.dimmed ? "dimmed" : undefined}
                  className={l.href ? "cursor-pointer" : undefined}
                  onClick={(e) => open(e, l.href)}
                >
                  {visible.map((d) => (
                    <Table.Td
                      key={d.id}
                      style={style(d.id)}
                      className={`${d.right ? "text-right tabular-nums" : ""} ${widthOf(d.id) ? "break-words" : ""}`}
                    >
                      {d.id === linkColumn ? (
                        <>
                          {l.href ? (
                            <Anchor component={Link} href={l.href} data-resultat size="sm" fw={500}>
                              {text(l.cells[d.id] ?? null)}
                            </Anchor>
                          ) : (
                            <span className="font-medium">{text(l.cells[d.id] ?? null)}</span>
                          )}
                          {l.badge && (
                            <Text
                              span
                              size="xs"
                              c="dimmed"
                              ml="xs"
                              px={6}
                              className="rounded border border-bordure font-normal"
                            >
                              {l.badge}
                            </Text>
                          )}
                        </>
                      ) : (
                        <CellContent def={d} value={l.cells[d.id] ?? null} link={l.links?.[d.id]} />
                      )}
                    </Table.Td>
                  ))}
                  <Table.Td />
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Paper>
      {pagination && pageCount(pagination.total) > 1 && (
        <ListPages noun={pagination.noun ?? caption} page={pagination.page} total={pagination.total} goTo={goToPage} />
      )}
    </div>
  );
}

/** Beyond this, a column save that has not answered is reported as failed. */
const SAVE_TIMEOUT = 15_000;

/** `promise`, or a rejection after `ms`: a request that never answers must not leave « Enregistrement… » on screen. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Width step of « Plus étroite » / « Plus large », in pixels. */
const WIDTH_STEP = 40;

/** Pages of a long list: « Élèves 51 à 100 sur 134 » and the page numbers, under the table and the cards. */
function ListPages({
  noun,
  page,
  total,
  goTo,
}: {
  noun: string;
  page: number;
  total: number;
  goTo: (page: number) => void;
}) {
  const { from, to } = shownRange(page, total);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
      <Text size="sm" c="dimmed" className="tabular-nums">
        {noun} {from} à {to} sur {total}
      </Text>
      <Pagination
        total={pageCount(total)}
        value={page}
        onChange={goTo}
        size="sm"
        siblings={1}
        getControlProps={(control) =>
          control === "previous"
            ? { "aria-label": "Page précédente" }
            : control === "next"
              ? { "aria-label": "Page suivante" }
              : {}
        }
        getItemProps={(n) => ({ "aria-label": `Page ${n}`, "aria-current": n === page ? "page" : undefined })}
      />
    </nav>
  );
}

const text = (v: CellValue) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

function CellContent({ def, value, link }: { def: ColumnDef; value: CellValue; link?: CellLink }) {
  const t = text(value);
  if (t === "")
    return (
      <Text span size="sm" c="dimmed">
        {def.ifEmpty ?? "—"}
      </Text>
    );
  if (def.type === "phone") {
    return (
      <Anchor href={`tel:${t.replace(/\s/g, "")}`} size="sm" className="whitespace-nowrap tabular-nums">
        {t}
      </Anchor>
    );
  }
  if (def.type === "date") {
    const shown = t.slice(0, 10).split("-").reverse().join("/");
    return link ? (
      <Anchor component={Link} href={link.href} aria-label={link.label} size="sm" className="whitespace-nowrap">
        {shown}
      </Anchor>
    ) : (
      <span className="whitespace-nowrap">{shown}</span>
    );
  }
  if (link) {
    return (
      <Anchor component={Link} href={link.href} aria-label={link.label} size="sm">
        {t}
      </Anchor>
    );
  }
  if (def.email) {
    return (
      <Anchor href={`mailto:${t}`} size="sm" className="break-all">
        {t}
      </Anchor>
    );
  }
  return t;
}

/**
 * Native popover (`popover`): above everything, closed by Escape or a click
 * elsewhere, focus returns to the button. Placed under its button when opened.
 * The trigger is a Mantine button (`buttonProps`), or an unstyled one laid
 * out by `plainClass` (column headers, « + »). A calendar opened inside
 * renders into `PopoverPortal`, inside the popover: rendered in `<body>`, it
 * would sit behind the popover (top layer) and a click on it would close it.
 */
function Popover({
  title,
  button,
  buttonProps,
  plainClass,
  buttonLabel,
  width: width = "w-80",
  children,
}: {
  title: string;
  button: ReactNode;
  buttonProps?: ButtonProps;
  plainClass?: string;
  buttonLabel?: string;
  width?: string;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);

  function positionPopover() {
    const b = trigger.current?.getBoundingClientRect();
    const p = popover.current;
    if (!b || !p) return;
    const left = Math.max(8, Math.min(b.left, window.innerWidth - p.offsetWidth - 8));
    const top =
      b.bottom + 4 + p.offsetHeight > window.innerHeight - 8 ? Math.max(8, b.top - 4 - p.offsetHeight) : b.bottom + 4;
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  }

  return (
    <>
      {plainClass !== undefined ? (
        <UnstyledButton ref={trigger} popoverTarget={id} className={plainClass} aria-label={buttonLabel}>
          {button}
        </UnstyledButton>
      ) : (
        <Button ref={trigger} popoverTarget={id} aria-label={buttonLabel} {...buttonProps}>
          {button}
        </Button>
      )}
      <Paper
        ref={popover}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={title}
        withBorder
        shadow="md"
        p="sm"
        // Paper sets `display`, which would beat the browser's rule hiding a closed popover.
        className={`fixed m-0 max-h-[70vh] max-w-[calc(100vw-1rem)] overflow-y-auto text-sm font-normal [inset:auto] [&:not(:popover-open)]:hidden ${width}`}
        onToggle={(e) => {
          if (e.newState !== "open") return;
          positionPopover();
          requestAnimationFrame(() => {
            positionPopover();
            const first = popover.current?.querySelector<HTMLElement>("input, button");
            // A date field first (column filterable, not sortable): focused
            // without opening its calendar over the menu (see `DateField`).
            if (first?.classList.contains("mantine-DateInput-input")) first.dataset.quietFocus = "1";
            first?.focus();
          });
        }}
      >
        <PopoverPortal value={portal}>{children}</PopoverPortal>
        <div ref={setPortal} />
      </Paper>
    </>
  );
}

/** Element inside the open popover where its calendars render (see `Popover`). */
const PopoverPortal = createContext<HTMLElement | null>(null);

/** Labels of the two sort directions, depending on the column's kind. */
const SORT_LABELS: Record<ColumnDef["type"], [string, string]> = {
  text: ["De A à Z", "De Z à A"],
  phone: ["Croissant", "Décroissant"],
  number: ["Du plus petit au plus grand", "Du plus grand au plus petit"],
  date: ["Du plus ancien au plus récent", "Du plus récent au plus ancien"],
};

/**
 * A column header and its menu, like an Excel autofilter: sort either way,
 * then filter according to the column's kind. The header shows the sort
 * direction (▲ ▼) and a filled funnel if the column is filtered; the ▾ arrow
 * signals that it can be clicked.
 */
function TitleMenu({
  def,
  choice,
  f,
  currentSort,
  sort,
  hide,
  width,
}: {
  def: ColumnDef;
  choice: readonly string[] | undefined;
  f: AddressFilter;
  currentSort: "asc" | "desc" | null;
  sort: (direction: "asc" | "desc" | null) => void;
  hide: (() => void) | null;
  /** Width from the keyboard; `automatic` is null when the width is already automatic. */
  width: { narrower: () => void; wider: () => void; automatic: (() => void) | null };
}) {
  const fc = readColumnFilter(f.filter, def);
  const filtered = columnFilterSummary(def, fc) !== null || fc.otherConditions.length > 0;
  const sortable = def.sortable !== false;
  const filterable = def.filterable !== false;
  const change = (updated: Partial<ColumnFilter>, deferred = false) =>
    f.change(writeColumnFilter(f.filter, def, { ...fc, ...updated }), deferred);
  const state = [
    currentSort === "asc" ? "trié, sens croissant" : currentSort === "desc" ? "trié, sens décroissant" : "",
    filtered ? "filtré" : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Popover
      title={`Trier ou filtrer « ${def.label} »`}
      buttonLabel={`${def.label} : trier ou filtrer${state ? ` (${state})` : ""}`}
      plainClass={`-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs font-medium hover:bg-accent-doux ${def.right ? "justify-end" : ""} ${currentSort || filtered ? "text-accent" : "text-doux"}`}
      width="w-72"
      button={
        <>
          <span className="truncate">{def.label}</span>
          {currentSort && (
            <span aria-hidden className="text-xs">
              {currentSort === "asc" ? "▲" : "▼"}
            </span>
          )}
          {filtered && (
            <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor">
              <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" />
            </svg>
          )}
          <Text span aria-hidden size="xs" c="dimmed">
            ▾
          </Text>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {sortable && (
          <div role="group" aria-label="Trier" className="flex flex-col gap-1">
            {(["asc", "desc"] as const).map((direction, i) => (
              <Button
                key={direction}
                variant={currentSort === direction ? "light" : "subtle"}
                color={currentSort === direction ? undefined : "gray"}
                size="compact-sm"
                justify="flex-start"
                fullWidth
                fw={currentSort === direction ? 500 : 400}
                aria-pressed={currentSort === direction}
                leftSection={
                  <span aria-hidden className="w-3 text-xs">
                    {direction === "asc" ? "▲" : "▼"}
                  </span>
                }
                onClick={() => sort(currentSort === direction ? null : direction)}
              >
                {SORT_LABELS[def.type][i]}
              </Button>
            ))}
          </div>
        )}
        {filterable && (
          <div className={`flex flex-col gap-2 ${sortable ? "border-t border-bordure pt-3" : ""}`}>
            <Text size="sm" fw={500}>
              Filtrer
            </Text>
            <TitleFilter def={def} choice={choice} fc={fc} change={change} />
            {fc.otherConditions.length > 0 && (
              <Text size="xs" c="dimmed">
                Aussi : {fc.otherConditions.map((c) => conditionLabel(c, [def])).join(", ")}
              </Text>
            )}
          </div>
        )}
        <div
          role="group"
          aria-label="Largeur de la colonne"
          className="flex flex-wrap items-center gap-1 border-t border-bordure pt-2"
        >
          <Text size="xs" c="dimmed" className="w-full">
            Largeur
          </Text>
          <Button size="compact-xs" variant="default" onClick={width.narrower}>
            Plus étroite
          </Button>
          <Button size="compact-xs" variant="default" onClick={width.wider}>
            Plus large
          </Button>
          {width.automatic && (
            <Button size="compact-xs" variant="subtle" onClick={width.automatic}>
              Automatique
            </Button>
          )}
        </div>
        {/* Nothing to clear nor to hide (a required column, unfiltered): no empty strip. */}
        {(filtered || hide) && (
          <div className="flex flex-wrap justify-between gap-2 border-t border-bordure pt-2 text-xs">
            {filtered ? (
              <Anchor
                component="button"
                type="button"
                size="xs"
                onClick={() => f.change(writeColumnFilter(f.filter, def, {}))}
              >
                Effacer ce filtre
              </Anchor>
            ) : (
              <span />
            )}
            {hide && (
              <Anchor component="button" type="button" size="xs" c="dimmed" onClick={hide}>
                Masquer la colonne
              </Anchor>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}

/** A column's filter according to its kind: checkboxes, bounds, or contained text. */
function TitleFilter({
  def,
  choice,
  fc,
  change,
}: {
  def: ColumnDef;
  choice: readonly string[] | undefined;
  fc: ColumnFilter;
  change: (updated: Partial<ColumnFilter>, deferred?: boolean) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const portal = use(PopoverPortal);

  if (def.type === "text" && choice) {
    const checked = fc.choice ?? [];
    const toggleChoice = (v: string) =>
      change({ choice: checked.includes(v) ? checked.filter((x) => x !== v) : [...checked, v] });
    const label = (v: string) => (v === EMPTY ? `(${def.ifEmpty ?? "vide"})` : v);
    // « (aucune) » only for a column that can be empty (`ifEmpty`).
    const all = def.ifEmpty ? [...choice, EMPTY] : [...choice];
    const visible = search ? all.filter((v) => label(v).toLowerCase().includes(search.toLowerCase())) : all;
    return (
      <>
        {choice.length > CELLS_WITHOUT_SEARCH && (
          <TextInput
            type="search"
            size="xs"
            placeholder="Chercher…"
            aria-label={`Chercher dans « ${def.label} »`}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        )}
        <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
          {visible.map((v) => (
            <li key={v}>
              <Checkbox
                size="xs"
                radius="xs"
                className="rounded px-1 py-1 hover:bg-accent-doux"
                checked={checked.includes(v)}
                onChange={() => toggleChoice(v)}
                label={
                  v === EMPTY ? (
                    <Text span size="sm" c="dimmed">
                      {label(v)}
                    </Text>
                  ) : (
                    label(v)
                  )
                }
              />
            </li>
          ))}
        </ul>
        <Text size="xs" c="dimmed">
          {checked.length ? "Seules les valeurs cochées restent affichées." : "Cochez les valeurs à garder."}
        </Text>
      </>
    );
  }

  if (def.type === "date") {
    // A day picked or a date typed in full filters at once; a refused or
    // half-typed date empties that bound, as an empty field did before.
    // Birth dates: the calendar opens on the decade of a child's birth, a year then a day away.
    const yearsBack = def.yearsBack
      ? { defaultLevel: "decade" as const, defaultDate: `${Number(todayInParis().slice(0, 4)) - 10}-01-01` }
      : {};
    const bound = (key: "min" | "max", word: string) => (
      <DateField
        id={`${id}-${key}`}
        size="xs"
        className="min-w-0 flex-1"
        {...yearsBack}
        // Fixed: placed on the screen, not clipped by the scrolling popover around it.
        // Above the fields: below, it would cover « Effacer ce filtre » and « Masquer la colonne ».
        popoverProps={{
          portalProps: { target: portal ?? undefined },
          floatingStrategy: "fixed",
          position: "top-start",
        }}
        value={fc[key]}
        onChange={(v) => change(key === "min" ? { min: v } : { max: v }, true)}
        aria-label={`${def.label} : ${word}`}
      />
    );
    return (
      <div className="flex items-center gap-2">
        <span aria-hidden>Du</span>
        {bound("min", "du")}
        <span aria-hidden>au</span>
        {bound("max", "au")}
      </div>
    );
  }

  if (def.type === "number") {
    return (
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-min`}>De</label>
        <TextInput
          id={`${id}-min`}
          size="xs"
          className="min-w-0 flex-1"
          inputMode="numeric"
          value={fc.min}
          onChange={(e) => change({ min: e.currentTarget.value }, true)}
        />
        <label htmlFor={`${id}-max`}>à</label>
        <TextInput
          id={`${id}-max`}
          size="xs"
          className="min-w-0 flex-1"
          inputMode="numeric"
          value={fc.max}
          onChange={(e) => change({ max: e.currentTarget.value }, true)}
        />
      </div>
    );
  }

  return (
    <>
      <TextInput
        id={`${id}-texte`}
        aria-label={`${def.label} contient`}
        type="search"
        size="xs"
        placeholder="Contient…"
        inputMode={def.type === "phone" ? "tel" : undefined}
        value={fc.text}
        onChange={(e) => change({ text: e.currentTarget.value }, true)}
      />
    </>
  );
}

/** True when the server answers that nobody is signed in; false if it cannot be reached. */
async function sessionExpired(): Promise<boolean> {
  try {
    const r = await fetch("/api/auth/get-session", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return r.ok && (await r.json()) === null;
  } catch {
    return false;
  }
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

/** « Colonnes » menu: show, hide and move columns. */
function ColumnsMenu({
  columns,
  availability,
  change,
  byDefault,
}: {
  columns: Map<string, ColumnDef>;
  availability: Layout;
  change: (d: Layout) => void;
  byDefault: () => void;
}) {
  const last = availability.filter((d) => d.visible).length === 1;
  return (
    <div className="flex flex-col gap-1">
      <Text size="xs" c="dimmed" mb={4}>
        Cochez les colonnes à afficher ; les flèches changent leur ordre.
      </Text>
      <ul className="flex flex-col divide-y divide-bordure">
        {availability.map((d, k) => {
          const def = columns.get(d.id);
          if (!def) return null;
          return (
            <li key={d.id} className="flex items-center gap-1 py-1.5">
              <Checkbox
                size="xs"
                radius="xs"
                className="flex-1"
                label={def.label}
                checked={d.visible}
                disabled={(d.visible && last) || def.required}
                onChange={() => change(toggle(availability, d.id))}
              />
              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={k === 0}
                aria-label={`Monter « ${def.label} »`}
                onClick={() => change(move(availability, d.id, -1))}
              >
                ↑
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={k === availability.length - 1}
                aria-label={`Descendre « ${def.label} »`}
                onClick={() => change(move(availability, d.id, 1))}
              >
                ↓
              </ActionIcon>
            </li>
          );
        })}
      </ul>
      <Anchor component="button" type="button" size="sm" mt={4} className="self-start" onClick={byDefault}>
        Revenir à la disposition par défaut
      </Anchor>
    </div>
  );
}
