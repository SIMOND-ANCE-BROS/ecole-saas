"use client";

import { Alert, Button, Paper, Text } from "@mantine/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { snap, arrange, toTime, toMinutes } from "@/domain/schedule/calendar";
import { type Hours, openRanges } from "@/domain/schedule/hours";
import { end } from "./format";

/** On-screen height of one minute (px): an hour is 64 px. */
const PX = 64 / 60;
/** Movement below which a press stays a click. */
const THRESHOLD = 4;

export type Slot = { weekday: number; startTime: string; durationMinutes: number };

/** Calendar block: a course of the typical week or a dated lesson. */
export type CalendarElement = Slot & {
  id: string;
  title: string;
  /** Detail lines (room and instructor, headcount…). */
  rows: string[];
  /** Small label (« 1 sem. sur 2 », « déplacée »). */
  tag?: string | null;
  /** Note in the alert colour (« complet », « annulée »). */
  alert?: string | null;
  /** Struck-through, greyed-out block (cancelled lesson). */
  bar?: boolean;
  href: string;
  movable: boolean;
};

/**
 * Column of one day; `closed`: label of a closure covering the whole school
 * that day; `note`: closures of only some sites or courses (#200).
 */
export type CalendarColumn = {
  day: number;
  title: string;
  closed?: string | null;
  note?: { text: string; title: string } | null;
};

/** Response to a move: done, refused, or a choice to offer (« cette séance seulement »…). */
export type CalendarResponse =
  | { status: "ok"; text: string; warnings: string[] }
  | { status: "choose"; question: string; choice: { value: string; label: string }[] }
  | { status: "refused"; message: string };
type Gesture =
  | { type: "move" | "resize"; id: string; x: number; y: number; origin: Slot; moved: boolean }
  | { type: "create"; day: number; y: number; anchor: number; moved: boolean };
/** Slot reached by the gesture in progress. */
type Target = { preview?: { id: string } & Slot; selection?: { day: number; start: number; duration: number } };

type Props = {
  elements: CalendarElement[];
  columns: CalendarColumn[];
  /** Displayed range, in minutes since midnight. */
  start: number;
  end: number;
  /** Opening hours of the displayed sites (#90): closed periods hatched; empty: nothing. */
  hours: Hours[];
  editable: boolean;
  highlighted?: string;
  /** Moves an element; `choice`: answer to a question asked by a "choose" response. */
  move: (id: string, slot: Slot, choice: string | null) => Promise<CalendarResponse>;
  /** Free slot chosen (click or drag): create a course. */
  create: (day: number, start: number, duration: number) => void;
};

/**
 * Calendar in columns (days) on a shared time axis: typical week of the
 * courses or dated week of the lessons (#79, #90). Management: dragging a block
 * moves it (day and time, to the quarter hour), pulling its bottom edge changes
 * its length, dragging over an empty slot creates a course; a click or a tap on
 * an empty slot offers a one-hour course. With the keyboard, each block opens
 * its record.
 */
export function Calendar({
  elements,
  columns: days,
  start: opening,
  end: closure,
  hours: hours,
  editable: editable,
  highlighted: highlighted,
  move: move,
  create: create,
}: Props) {
  const router = useRouter();
  const [inProgress, startTransition] = useTransition();
  /** Slot shown during a gesture, then until the data reloads. */
  const [preview, setPreview] = useState<({ id: string } & Slot) | null>(null);
  const [selection, setSelection] = useState<{ day: number; start: number; duration: number } | null>(null);
  const [toConfirm, setToConfirm] = useState<{
    id: string;
    slot: Slot;
    question: string;
    choice: { value: string; label: string }[];
  } | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "refused"; text: string; warnings: string[] } | null>(null);
  const columns = useRef(new Map<number, HTMLDivElement>());
  const justDragged = useRef(false);

  /** Closed periods of a day (greyed out), when opening hours are known. */
  const fermees = (day: number) => {
    if (hours.length === 0) return [];
    const r: { start: number; end: number }[] = [];
    let cursor = opening;
    for (const p of openRanges(hours, day)) {
      if (p.start > cursor) r.push({ start: cursor, end: Math.min(p.start, closure) });
      cursor = Math.max(cursor, p.end);
    }
    if (cursor < closure) r.push({ start: cursor, end: closure });
    return r;
  };
  const displayed = elements.map((c) => (preview?.id === c.id ? { ...c, ...preview } : c));
  const seats = arrange(displayed);
  const height = (closure - opening) * PX;
  const hourMarks = Array.from({ length: (closure - opening) / 60 + 1 }, (_, i) => opening + i * 60);

  const minuteA = (clientY: number, day: number) => {
    const rect = columns.current.get(day)?.getBoundingClientRect();
    return rect ? opening + (clientY - rect.top) / PX : opening;
  };
  const dayA = (clientX: number) => {
    for (const [day, el] of columns.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return day;
    }
    return null;
  };

  function send(id: string, slot: Slot, choice: string | null) {
    setMessage(null);
    startTransition(async () => {
      let r: CalendarResponse;
      try {
        r = await move(id, slot, choice);
      } catch {
        r = { status: "refused", message: "Le déplacement n’a pas pu être enregistré : réessayez." };
      }
      if (r.status === "choose") {
        setToConfirm({ id, slot, question: r.question, choice: r.choice });
        return;
      }
      setToConfirm(null);
      if (r.status === "refused") {
        setPreview(null);
        setMessage({ type: "refused", text: r.message, warnings: [] });
        return;
      }
      setMessage({ type: "ok", text: r.text, warnings: r.warnings });
      router.refresh();
      setPreview(null);
    });
  }

  function cancel() {
    setToConfirm(null);
    setPreview(null);
  }

  const next = create;

  /**
   * Live state of the gesture, read by the window listeners: events in
   * quick succession arrive before the next render, so the React state
   * would still be the previous one.
   */
  const gesture = useRef<(Gesture & Target) | null>(null);
  const [active, setActive] = useState(false);

  function beginGesture(g: Gesture) {
    gesture.current = g;
    setActive(true);
  }

  // Gestures on a course: move (body) or stretch (bottom edge).
  function enterCourse(e: React.PointerEvent, c: CalendarElement, type: "move" | "resize") {
    if (!editable || !c.movable || e.button !== 0 || inProgress || toConfirm) return;
    e.stopPropagation();
    justDragged.current = false;
    beginGesture({
      type,
      id: c.id,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      origin: { weekday: c.weekday, startTime: c.startTime, durationMinutes: c.durationMinutes },
    });
  }

  // Drag over an empty slot (mouse): choose the start and length of a new course.
  function enterOnEmptySlot(e: React.PointerEvent, day: number) {
    if (!editable || e.button !== 0 || e.pointerType !== "mouse" || inProgress || toConfirm) return;
    const anchor = Math.max(opening, Math.floor(minuteA(e.clientY, day) / 15) * 15);
    beginGesture({ type: "create", day, y: e.clientY, anchor, moved: false });
  }

  function trackPointer(e: PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    g.moved ||= Math.abs(e.clientY - g.y) > THRESHOLD || (g.type !== "create" && Math.abs(e.clientX - g.x) > THRESHOLD);
    if (!g.moved) return;
    if (g.type === "create") {
      const here = Math.min(closure, Math.max(opening, snap(minuteA(e.clientY, g.day))));
      g.selection = { day: g.day, start: Math.min(g.anchor, here), duration: Math.max(15, Math.abs(here - g.anchor)) };
      setSelection(g.selection);
      return;
    }
    const { origin: origin } = g;
    const shift = snap((e.clientY - g.y) / PX);
    if (g.type === "resize") {
      const start = toMinutes(origin.startTime);
      g.preview = {
        id: g.id,
        ...origin,
        durationMinutes: Math.min(closure - start, Math.max(15, origin.durationMinutes + shift)),
      };
    } else {
      const start = Math.min(closure - origin.durationMinutes, Math.max(opening, toMinutes(origin.startTime) + shift));
      g.preview = {
        id: g.id,
        ...origin,
        weekday: dayA(e.clientX) ?? origin.weekday,
        startTime: toTime(start),
      };
    }
    setPreview(g.preview);
  }

  function release() {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setActive(false);
    if (g.type === "create") {
      setSelection(null);
      if (g.moved && g.selection) next(g.selection.day, g.selection.start, g.selection.duration);
      else next(g.day, g.anchor, 60);
      return;
    }
    if (!g.moved) return; // plain click: the link opens the record
    justDragged.current = true;
    const a = g.preview;
    if (
      !a ||
      (a.weekday === g.origin.weekday &&
        a.startTime === g.origin.startTime &&
        a.durationMinutes === g.origin.durationMinutes)
    ) {
      setPreview(null);
      return;
    }
    send(g.id, { weekday: a.weekday, startTime: a.startTime, durationMinutes: a.durationMinutes }, null);
  }

  function drop() {
    gesture.current = null;
    setActive(false);
    setSelection(null);
    setPreview(null);
  }

  // The gesture is tracked over the whole window: the course changes column
  // along the way (and loses the pointer capture), and it can be dropped
  // outside the grid. Escape cancels.
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && drop();
    window.addEventListener("pointermove", trackPointer);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", drop);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", drop);
      window.removeEventListener("keydown", key);
    };
  });

  // (Touch) tap on an empty slot: a one-hour course at that spot.
  function tapEmptySlot(e: React.MouseEvent, day: number) {
    if (!editable || inProgress || toConfirm || e.target !== e.currentTarget) return;
    if ((e.nativeEvent as PointerEvent).pointerType === "mouse") return; // handled by enterOnEmptySlot
    next(day, Math.max(opening, Math.min(closure - 60, Math.floor(minuteA(e.clientY, day) / 15) * 15)), 60);
  }

  return (
    <div className="flex flex-col gap-3">
      {toConfirm && (
        <Paper
          withBorder
          p="sm"
          role="alertdialog"
          aria-labelledby="confirmer-deplacement"
          className="flex flex-wrap items-center gap-3 border-accent text-sm"
        >
          <p id="confirmer-deplacement" className="flex-1">
            {toConfirm.question}
          </p>
          <div className="flex flex-wrap gap-2">
            {toConfirm.choice.map((c, i) => (
              <Button
                key={c.value}
                variant={i === 0 ? "filled" : "default"}
                disabled={inProgress}
                onClick={() => send(toConfirm.id, toConfirm.slot, c.value)}
                autoFocus={i === 0}
              >
                {c.label}
              </Button>
            ))}
            <Button variant="default" disabled={inProgress} onClick={cancel}>
              Annuler
            </Button>
          </div>
        </Paper>
      )}
      <div aria-live="polite">
        {message && (
          <Alert role="status" color={message.type === "ok" ? undefined : "red"}>
            <p>{message.text}</p>
            {message.warnings.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-alerte-texte">
                {message.warnings.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </div>
      {editable && (
        <Text size="xs" c="dimmed">
          Glissez un bloc pour le déplacer, tirez son bord bas pour changer sa durée, cliquez ou glissez sur un créneau
          libre pour créer un cours.
        </Text>
      )}

      <Paper withBorder className="overflow-x-auto">
        <div
          className="grid min-w-[44rem] select-none"
          style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(6.5rem, 1fr))` }}
        >
          <div className="sticky left-0 z-20 border-b border-bordure bg-surface" />
          {days.map((c) => (
            <h2 key={c.day} className="border-b border-l border-bordure px-2 py-1.5 text-sm font-semibold">
              {c.title}
              {c.closed && <span className="block truncate text-xs font-normal text-alerte-texte">{c.closed}</span>}
              {c.note && (
                <span className="line-clamp-2 block text-xs font-normal text-alerte-texte" title={c.note.title}>
                  {c.note.text}
                </span>
              )}
            </h2>
          ))}

          <div className="sticky left-0 z-20 bg-surface" style={{ height: height }} aria-hidden>
            {hourMarks.map((h) => (
              <span
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-xs tabular-nums text-doux"
                style={{ top: (h - opening) * PX }}
              >
                {h < closure && h > opening ? `${h / 60} h` : ""}
              </span>
            ))}
          </div>
          {days.map(({ day: j, closed: closed }) => (
            <div
              key={j}
              ref={(el) => {
                if (el) columns.current.set(j, el);
                else columns.current.delete(j);
              }}
              className={`relative border-l border-bordure ${editable ? "cursor-cell" : ""}`}
              style={{
                height: height,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--bordure) 0 1px, transparent 1px ${60 * PX}px)`,
              }}
              onPointerDown={(e) => enterOnEmptySlot(e, j)}
              onClick={(e) => tapEmptySlot(e, j)}
            >
              {closed && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent_0_6px,var(--alerte-fond)_6px_8px)]"
                />
              )}
              {fermees(j).map((z) => (
                <div
                  key={z.start}
                  aria-hidden
                  title="Site fermé"
                  className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(45deg,transparent_0_6px,var(--bordure)_6px_7px)] opacity-70"
                  style={{ top: (z.start - opening) * PX, height: (z.end - z.start) * PX }}
                />
              ))}
              {selection?.day === j && (
                <div
                  className="pointer-events-none absolute inset-x-1 z-10 rounded border-2 border-dashed border-accent bg-accent-doux/60 px-1.5 text-xs font-medium"
                  style={{ top: (selection.start - opening) * PX, height: selection.duration * PX }}
                >
                  {toTime(selection.start)}–{toTime(selection.start + selection.duration)}
                </div>
              )}
              {displayed
                .filter((c) => c.weekday === j)
                .map((c) => {
                  const place = seats.get(c.id) ?? { column: 0, columns: 1 };
                  const start = toMinutes(c.startTime);
                  const moved = preview?.id === c.id;
                  const width = 100 / place.columns;
                  return (
                    <div
                      key={c.id}
                      className={`absolute overflow-hidden rounded border-l-4 border-accent bg-accent-doux text-xs shadow-sm ${
                        c.id === highlighted ? "ring-2 ring-accent" : ""
                      } ${moved ? "z-10 opacity-90 ring-2 ring-accent" : ""} ${c.bar ? "border-doux opacity-60" : ""} ${
                        editable && c.movable ? "cursor-grab touch-none active:cursor-grabbing" : ""
                      }`}
                      style={{
                        top: (start - opening) * PX + 1,
                        height: Math.max(18, c.durationMinutes * PX - 2),
                        left: `calc(${place.column * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                      onPointerDown={(e) => enterCourse(e, c, "move")}
                    >
                      <Link
                        href={c.href}
                        draggable={false}
                        className="block h-full px-1.5 py-0.5 leading-tight text-texte focus-visible:outline-2 focus-visible:outline-accent"
                        onClick={(e) => {
                          if (justDragged.current) {
                            e.preventDefault();
                            justDragged.current = false;
                          }
                        }}
                      >
                        <span className={`block font-semibold ${c.bar ? "line-through" : ""}`}>
                          {c.title}
                          {c.alert && <span className="font-normal text-alerte-texte"> · {c.alert}</span>}
                          {c.tag && <span className="ml-1 rounded bg-surface px-1 font-normal text-doux">{c.tag}</span>}
                        </span>
                        <span className="block tabular-nums">
                          {c.startTime}–{end(c.startTime, c.durationMinutes)}
                        </span>
                        {c.rows.map((l) => (
                          <span key={l} className="block truncate text-doux">
                            {l}
                          </span>
                        ))}
                      </Link>
                      {editable && c.movable && (
                        <div
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                          onPointerDown={(e) => enterCourse(e, c, "resize")}
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </Paper>
    </div>
  );
}
