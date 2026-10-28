"use client";

import { useEffect, useRef } from "react";

/**
 * Focus to move once the next render is on screen: an inline edit closes and
 * its row's « Modifier » button comes back, or a removed row's list takes it
 * (#186). Call it just before the state change that brings the target back;
 * the first selector that matches wins, the next ones are fallbacks (a
 * refused removal's « Retirer », else its list when the row is already gone).
 *
 * Pending while disabled (#243): when the action ends, the matched target
 * may still be disabled for one render (`inProgress`); a disabled element
 * cannot take focus, so the request waits for the next render instead of
 * falling back or being dropped.
 */
export function useFocusAfter() {
  const next = useRef<string[] | null>(null);
  useEffect(() => {
    if (!next.current) return;
    const target = next.current.map((s) => document.querySelector<HTMLElement>(s)).find((x) => x !== null);
    if (target?.matches(":disabled")) return;
    next.current = null;
    target?.focus();
  });
  return (...selectors: string[]) => {
    next.current = selectors;
  };
}
