"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
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
import { saveColumns } from "./actions";
import { type AddressFilter, useAddressFilter } from "./address-filter";

export type CellValue = string | number | string[] | null;
export type TableRow = {
  id: string;
  /** Record link for the column named by `linkColumn`; absent: plain text. */
  href?: string;
  /** Greyed-out row (inactive instructor…). */
  dimmed?: boolean;
  /** Small badge after the name (« inactif », « organisme »). */
  badge?: string;
  cells: Record<string, CellValue>;
};

type Props = {
  list: List;
  /** « les élèves »: for accessible labels. */
  what: string;
  caption: string;
  columns: ColumnDef[];
  /** The member's saved layout, or null. */
  layout: string[] | null;
  rows: TableRow[];
  /** Column carrying the link to the record. */
  linkColumn: string;
  /** Message when no row is shown. */
  vide: string;
  /** Phone-specific display (the table is hidden there). */
  mobile?: ReactNode;
  /** Checkbox values supplied by the page, per column (courses of the season, statuses…). */
  choice?: Record<string, readonly string[]>;
  /** Action offered when the list is empty without a filter (« Nouvel élève »). */
  emptyAction?: ReactNode;
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
export function ListTable({
  list: list,
  what: what,
  caption: caption,
  columns: columns,
  layout: layout,
  rows: rows,
  linkColumn: linkColumn,
  vide,
  mobile,
  choice: choice = {},
  emptyAction: emptyAction,
}: Props) {
  const f = useAddressFilter(columns);
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [sortPending, startSort] = useTransition();
  const currentSort = readSort(params.get("sort"), params.get("order"), columns);
  const [availability, setAvailability] = useState<Layout>(() => readLayout(columns, layout));
  const [saving, startTransition] = useTransition();
  const [failure, setFailure] = useState(false);
  const defs = new Map(columns.map((c) => [c.id, c]));
  const visible = availability.filter((d) => d.visible).flatMap((d) => defs.get(d.id) ?? []);
  const masquees = availability.filter((d) => !d.visible).flatMap((d) => defs.get(d.id) ?? []);
  const widthOf = (id: string) => availability.find((d) => d.id === id)?.width ?? null;
  const style = (id: string) => {
    const l = widthOf(id);
    return l ? { width: l, minWidth: l, maxWidth: l } : undefined;
  };
  const choiceOf = (d: ColumnDef) => choice[d.id] ?? d.choice;

  function setSort(next: Sort | null) {
    const p = new URLSearchParams(params.toString());
    p.delete("sort");
    p.delete("order");
    if (next) {
      p.set("sort", next.column);
      p.set("order", next.sens);
    }
    const text = p.toString();
    startSort(() => router.replace(text ? `${path}?${text}` : path, { scroll: false }));
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
    setFailure(false);
    startTransition(async () => setFailure(!(await saveColumns(list, writeLayout(d)))));
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
  const pastilles = columns.flatMap((d) => {
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
  const filter = pastilles.length > 0;
  const clearAll = () => f.change({ mode: "et", conditions: [] });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
        {filter ? (
          <>
            <ul className="flex flex-wrap gap-1.5" aria-label="Filtres actifs">
              {pastilles.map((p) => (
                <li
                  key={p.key}
                  className="flex items-center gap-1 rounded-full border border-accent bg-accent-doux py-0.5 pr-1 pl-2.5"
                >
                  {p.text}
                  <button
                    type="button"
                    className="rounded-full px-1.5 hover:bg-surface"
                    aria-label={`Retirer le filtre ${p.text}`}
                    onClick={p.remove}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="lien" onClick={clearAll}>
              Effacer les filtres
            </button>
          </>
        ) : (
          <span className={`text-doux ${mobile ? "hidden sm:inline" : ""}`}>
            Cliquez sur le titre d’une colonne pour trier ou filtrer.
          </span>
        )}
        <span className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-doux" role="status">
            {f.inProgress || sortPending
              ? "Mise à jour…"
              : saving
                ? "Enregistrement des colonnes…"
                : failure
                  ? "Disposition non enregistrée : réessayez."
                  : ""}
          </span>
          {/* On phones, cards: no columns to adjust. */}
          <span className={mobile ? "hidden sm:inline" : ""}>
            <Popover
              title={`Colonnes de ${what}`}
              button={masquees.length ? `Colonnes (${masquees.length} de plus)` : "Colonnes"}
              buttonClass="bouton-secondaire"
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
      <div className={`panneau overflow-x-auto ${mobile ? "hidden sm:block" : ""}`}>
        <table className="tableau">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {visible.map((d) => (
                <th
                  key={d.id}
                  scope="col"
                  aria-sort={
                    currentSort?.column === d.id ? (currentSort.sens === "asc" ? "ascending" : "descending") : undefined
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
                    currentSort={currentSort?.column === d.id ? currentSort.sens : null}
                    sort={(sens) => setSort(sens ? { column: d.id, sens } : null)}
                    hide={
                      visible.length > 1 && !d.required ? () => changeAvailability(toggle(availability, d.id)) : null
                    }
                  />
                  <span
                    aria-hidden
                    data-poignee="1"
                    title="Tirez pour changer la largeur, double-cliquez pour la largeur automatique"
                    className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-accent/40"
                    onPointerDown={(e) => startResize(e, d.id)}
                    onDoubleClick={() => changeAvailability(resize(availability, d.id, null))}
                  />
                </th>
              ))}
              <th scope="col" className="w-8 px-1 text-right">
                <Popover
                  title="Ajouter une colonne"
                  buttonLabel="Ajouter une colonne"
                  button="+"
                  buttonClass="rounded px-2 py-0.5 text-base leading-none text-accent hover:bg-accent-doux"
                >
                  <p className="mb-2 font-medium">Ajouter une colonne</p>
                  {masquees.length === 0 ? (
                    <p className="text-doux">Toutes les colonnes sont affichées.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {masquees.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="lien"
                            onClick={() => changeAvailability(place(toggle(availability, c.id), c.id, null))}
                          >
                            {c.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-doux">
                    Pour retirer une colonne : cliquez sur son titre, puis « Masquer la colonne ».
                  </p>
                </Popover>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visible.length + 1} className="py-6 text-center">
                  <p className="text-doux">{vide}</p>
                  <div className="mt-3 flex justify-center gap-3">
                    {filter ? (
                      <button type="button" className="bouton-secondaire" onClick={clearAll}>
                        Effacer les filtres
                      </button>
                    ) : (
                      emptyAction
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((l) => (
                <tr
                  key={l.id}
                  className={`${l.dimmed ? "text-doux" : ""} ${l.href ? "cursor-pointer" : ""}`}
                  onClick={(e) => open(e, l.href)}
                >
                  {visible.map((d) => (
                    <td
                      key={d.id}
                      style={style(d.id)}
                      className={`${d.right ? "text-right tabular-nums" : ""} ${widthOf(d.id) ? "break-words" : ""}`}
                    >
                      {d.id === linkColumn ? (
                        <>
                          {l.href ? (
                            <Link href={l.href} data-resultat className="lien font-medium">
                              {text(l.cells[d.id])}
                            </Link>
                          ) : (
                            <span className="font-medium">{text(l.cells[d.id])}</span>
                          )}
                          {l.badge && (
                            <span className="ml-2 rounded border border-bordure px-1.5 text-xs font-normal text-doux">
                              {l.badge}
                            </span>
                          )}
                        </>
                      ) : (
                        <CellContent def={d} value={l.cells[d.id]} />
                      )}
                    </td>
                  ))}
                  <td />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const text = (v: CellValue) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

function CellContent({ def, value: value }: { def: ColumnDef; value: CellValue }) {
  const t = text(value);
  if (t === "") return <span className="text-doux">{def.ifEmpty ?? "—"}</span>;
  if (def.type === "telephone") {
    return (
      <a href={`tel:${t.replace(/\s/g, "")}`} className="lien whitespace-nowrap tabular-nums">
        {t}
      </a>
    );
  }
  if (def.type === "date") return t.slice(0, 10).split("-").reverse().join("/");
  if (def.email) {
    return (
      <a href={`mailto:${t}`} className="lien break-all">
        {t}
      </a>
    );
  }
  return t;
}

/**
 * Native popover (`popover`): above everything, closed by Escape or a click
 * elsewhere, focus returns to the button. Placed under its button when opened.
 */
function Popover({
  title: title,
  button: button,
  buttonClass: buttonClass,
  buttonLabel: buttonLabel,
  width: width = "w-80",
  children,
}: {
  title: string;
  button: ReactNode;
  buttonClass: string;
  buttonLabel?: string;
  width?: string;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

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
      <button ref={trigger} type="button" popoverTarget={id} className={buttonClass} aria-label={buttonLabel}>
        {button}
      </button>
      <div
        ref={popover}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={title}
        className={`panneau fixed m-0 max-h-[70vh] max-w-[calc(100vw-1rem)] overflow-y-auto p-3 text-sm font-normal text-texte shadow-lg [inset:auto] ${width}`}
        onToggle={(e) => {
          if (e.newState !== "open") return;
          positionPopover();
          requestAnimationFrame(() => {
            positionPopover();
            popover.current?.querySelector<HTMLElement>("input, button")?.focus();
          });
        }}
      >
        {children}
      </div>
    </>
  );
}

/** Labels of the two sort directions, depending on the column's kind. */
const SENS: Record<ColumnDef["type"], [string, string]> = {
  texte: ["De A à Z", "De Z à A"],
  telephone: ["Croissant", "Décroissant"],
  nombre: ["Du plus petit au plus grand", "Du plus grand au plus petit"],
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
  choice: choice,
  f,
  currentSort: currentSort,
  sort: sort,
  hide: hide,
}: {
  def: ColumnDef;
  choice: readonly string[] | undefined;
  f: AddressFilter;
  currentSort: "asc" | "desc" | null;
  sort: (sens: "asc" | "desc" | null) => void;
  hide: (() => void) | null;
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
      buttonClass={`-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-accent-doux ${def.right ? "justify-end" : ""} ${currentSort || filtered ? "text-accent" : ""}`}
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
          <span aria-hidden className="text-xs text-doux">
            ▾
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {sortable && (
          <div role="group" aria-label="Trier" className="flex flex-col gap-1">
            {(["asc", "desc"] as const).map((sens, i) => (
              <button
                key={sens}
                type="button"
                aria-pressed={currentSort === sens}
                className={`flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent-doux ${currentSort === sens ? "bg-accent-doux font-medium text-accent" : ""}`}
                onClick={() => sort(currentSort === sens ? null : sens)}
              >
                <span aria-hidden className="w-3 text-xs">
                  {sens === "asc" ? "▲" : "▼"}
                </span>
                {SENS[def.type][i]}
              </button>
            ))}
          </div>
        )}
        {filterable && (
          <div className={`flex flex-col gap-2 ${sortable ? "border-t border-bordure pt-3" : ""}`}>
            <p className="font-medium">Filtrer</p>
            <TitleFilter def={def} choice={choice} fc={fc} change={change} />
            {fc.otherConditions.length > 0 && (
              <p className="text-xs text-doux">
                Aussi : {fc.otherConditions.map((c) => conditionLabel(c, [def])).join(", ")}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 border-t border-bordure pt-2 text-xs">
          {filtered ? (
            <button type="button" className="lien" onClick={() => f.change(writeColumnFilter(f.filter, def, {}))}>
              Effacer ce filtre
            </button>
          ) : (
            <span />
          )}
          {hide && (
            <button type="button" className="lien text-doux" onClick={hide}>
              Masquer la colonne
            </button>
          )}
        </div>
      </div>
    </Popover>
  );
}

/** A column's filter according to its kind: checkboxes, bounds, or contained text. */
function TitleFilter({
  def,
  choice: choice,
  fc,
  change: change,
}: {
  def: ColumnDef;
  choice: readonly string[] | undefined;
  fc: ColumnFilter;
  change: (updated: Partial<ColumnFilter>, deferred?: boolean) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");

  if (def.type === "texte" && choice) {
    const checked = fc.choice ?? [];
    const toggleChoice = (v: string) =>
      change({ choice: checked.includes(v) ? checked.filter((x) => x !== v) : [...checked, v] });
    const label = (v: string) => (v === EMPTY ? `(${def.ifEmpty ?? "vide"})` : v);
    // « (aucune) » only for a column that can be empty (`ifEmpty`).
    const toutes = def.ifEmpty ? [...choice, EMPTY] : [...choice];
    const visible = search ? toutes.filter((v) => label(v).toLowerCase().includes(search.toLowerCase())) : toutes;
    return (
      <>
        {choice.length > CELLS_WITHOUT_SEARCH && (
          <input
            type="search"
            className="champ"
            placeholder="Chercher…"
            aria-label={`Chercher dans « ${def.label} »`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
          {visible.map((v) => (
            <li key={v}>
              <label className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent-doux">
                <input type="checkbox" checked={checked.includes(v)} onChange={() => toggleChoice(v)} />
                <span className={v === EMPTY ? "text-doux" : ""}>{label(v)}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-xs text-doux">
          {checked.length ? "Seules les valeurs cochées restent affichées." : "Cochez les valeurs à garder."}
        </p>
      </>
    );
  }

  if (def.type === "nombre" || def.type === "date") {
    const date = def.type === "date";
    return (
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-min`}>{date ? "Du" : "De"}</label>
        <input
          id={`${id}-min`}
          className="champ w-full min-w-0"
          type={date ? "date" : "text"}
          inputMode={date ? undefined : "numeric"}
          value={fc.min}
          onChange={(e) => change({ min: e.target.value }, true)}
        />
        <label htmlFor={`${id}-max`}>{date ? "au" : "à"}</label>
        <input
          id={`${id}-max`}
          className="champ w-full min-w-0"
          type={date ? "date" : "text"}
          inputMode={date ? undefined : "numeric"}
          value={fc.max}
          onChange={(e) => change({ max: e.target.value }, true)}
        />
      </div>
    );
  }

  return (
    <>
      <label htmlFor={`${id}-texte`} className="sr-only">
        {def.label} contient
      </label>
      <input
        id={`${id}-texte`}
        type="search"
        className="champ"
        placeholder="Contient…"
        inputMode={def.type === "telephone" ? "tel" : undefined}
        value={fc.text}
        onChange={(e) => change({ text: e.target.value }, true)}
      />
    </>
  );
}

/** « Colonnes » menu: show, hide and move columns. */
function ColumnsMenu({
  columns: columns,
  availability: availability,
  change: change,
  byDefault: byDefault,
}: {
  columns: Map<string, ColumnDef>;
  availability: Layout;
  change: (d: Layout) => void;
  byDefault: () => void;
}) {
  const last = availability.filter((d) => d.visible).length === 1;
  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-xs text-doux">Cochez les colonnes à afficher ; les flèches changent leur ordre.</p>
      <ul className="flex flex-col divide-y divide-bordure">
        {availability.map((d, k) => {
          const def = columns.get(d.id);
          if (!def) return null;
          return (
            <li key={d.id} className="flex items-center gap-1 py-1.5">
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.visible}
                  disabled={(d.visible && last) || def.required}
                  onChange={() => change(toggle(availability, d.id))}
                />
                {def.label}
              </label>
              <button
                type="button"
                className="rounded px-1.5 hover:bg-accent-doux disabled:opacity-30"
                disabled={k === 0}
                aria-label={`Monter « ${def.label} »`}
                onClick={() => change(move(availability, d.id, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="rounded px-1.5 hover:bg-accent-doux disabled:opacity-30"
                disabled={k === availability.length - 1}
                aria-label={`Descendre « ${def.label} »`}
                onClick={() => change(move(availability, d.id, 1))}
              >
                ↓
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="lien mt-1 self-start text-sm" onClick={byDefault}>
        Revenir à la disposition par défaut
      </button>
    </div>
  );
}
