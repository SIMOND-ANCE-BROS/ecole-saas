"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  type Condition,
  type ColumnDef,
  type Filter,
  readFilter,
  OPERATORS,
  withoutValue,
  normalizedValue,
  toParams,
} from "@/domain/filters/filters";
import { has } from "@/lib/has";

/** Delay before applying a typed value (the list reloads from the server). */
const DELAY = 350;

/**
 * A list's filter (#87, #89): local state, of which only complete conditions
 * go into the URL (`?f=…&mode=ou`) that the page reads back on the server.
 * A condition still being typed stays local.
 */
export function useAddressFilter(columns: readonly ColumnDef[]) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [inProgress, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>(() => readFilter(params.getAll("f"), params.get("mode"), columns));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const typeDe = (column: string) => columns.find((c) => c.id === column)?.type ?? "text";
  const complete = (c: Condition) => normalizedValue(c, typeDe(c.column)) !== null;

  function publish(f: Filter, deferred = false) {
    clearTimeout(timer.current);
    const send = () => {
      const p = new URLSearchParams(params.toString());
      p.delete("f");
      p.delete("mode");
      for (const [key, value] of toParams({ ...f, conditions: f.conditions.filter(complete) })) p.append(key, value);
      const text = p.toString();
      startTransition(() => router.replace(text ? `${path}?${text}` : path, { scroll: false }));
    };
    if (deferred) timer.current = setTimeout(send, DELAY);
    else send();
  }

  /** Changes the filter; `deferred` for a value still being typed. */
  function change(f: Filter, deferred = false) {
    setFilter(f);
    publish(f, deferred);
  }

  /** Updates the condition at index `i` (operator adapted to the column type, value cleared when unused). */
  function update(i: number, updated: Partial<Condition>) {
    const conditions = filter.conditions.map((c, j) => {
      if (j !== i) return c;
      const next = { ...c, ...updated };
      const ops = OPERATORS[typeDe(next.column)];
      if (!ops.includes(next.operator)) next.operator = ops[0];
      if (withoutValue(next.operator)) next.value = "";
      return next;
    });
    change({ ...filter, conditions }, has(updated, "value"));
  }

  /** New empty condition on a column: nothing to reload until it has a value. */
  function add(column: string) {
    setFilter({
      ...filter,
      conditions: [...filter.conditions, { column, operator: OPERATORS[typeDe(column)][0], value: "" }],
    });
  }

  function remove(i: number) {
    change({ ...filter, conditions: filter.conditions.filter((_, j) => j !== i) });
  }

  /** When a popover closes: drops this column's conditions left without a value (never published). */
  function clean(column: string) {
    setFilter((f) => ({ ...f, conditions: f.conditions.filter((c) => c.column !== column || complete(c)) }));
  }

  return {
    filter: filter,
    inProgress: inProgress,
    typeDe,
    complete,
    change: change,
    update: update,
    add: add,
    remove: remove,
    clean: clean,
    apply: () => publish(filter),
  };
}

export type AddressFilter = ReturnType<typeof useAddressFilter>;
