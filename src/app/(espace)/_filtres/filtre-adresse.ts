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
} from "@/domaine/filtres/filtres";

/** Délai avant d'appliquer une valeur tapée (la liste se recharge depuis le serveur). */
const DELAY = 350;

/**
 * Filtre d'une liste (#87, #89) : état local, dont seules les conditions
 * complètes vont dans l'adresse (`?f=…&mode=ou`) que la page relit côté
 * serveur. Une condition en cours de saisie reste locale.
 */
export function useAddressFilter(columns: ColumnDef[]) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [inProgress, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>(() => readFilter(params.getAll("f"), params.get("mode"), columns));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const typeDe = (column: string) => columns.find((c) => c.id === column)?.type ?? "texte";
  const complete = (c: Condition) => normalizedValue(c, typeDe(c.column)) !== null;

  function publish(f: Filter, deferred = false) {
    clearTimeout(timer.current);
    const send = () => {
      const p = new URLSearchParams(params.toString());
      p.delete("f");
      p.delete("mode");
      for (const [key, value] of toParams({ ...f, conditions: f.conditions.filter(complete) })) p.append(key, value);
      const texte = p.toString();
      startTransition(() => router.replace(texte ? `${path}?${texte}` : path, { scroll: false }));
    };
    if (deferred) timer.current = setTimeout(send, DELAY);
    else send();
  }

  /** Change le filtre ; `differe` pour une valeur en cours de frappe. */
  function change(f: Filter, deferred = false) {
    setFilter(f);
    publish(f, deferred);
  }

  /** Modifie la condition d'indice `i` (opérateur adapté au type de la colonne, valeur vidée si inutile). */
  function update(i: number, updated: Partial<Condition>) {
    const conditions = filter.conditions.map((c, j) => {
      if (j !== i) return c;
      const next = { ...c, ...updated };
      const ops = OPERATORS[typeDe(next.column)];
      if (!ops.includes(next.operator)) next.operator = ops[0];
      if (withoutValue(next.operator)) next.value = "";
      return next;
    });
    change({ ...filter, conditions }, ("value" satisfies keyof Condition) in updated);
  }

  /** Nouvelle condition vide sur une colonne : rien à recharger tant qu'elle n'a pas de valeur. */
  function add(column: string) {
    setFilter({
      ...filter,
      conditions: [...filter.conditions, { column, operator: OPERATORS[typeDe(column)][0], value: "" }],
    });
  }

  function remove(i: number) {
    change({ ...filter, conditions: filter.conditions.filter((_, j) => j !== i) });
  }

  /** À la fermeture d'une bulle : oublie les conditions de cette colonne restées sans valeur (jamais publiées). */
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
