"use client";

import { useEffect, useRef } from "react";

/**
 * Focus to move once the next render is on screen: an inline edit closes and
 * its row's « Modifier » button comes back, or a removed row's list takes it
 * (#186). Call it just before the state change that brings the target back;
 * the first selector that matches wins. A target still disabled while the
 * action ends (a refused removal's « Retirer », #243) is waited for over the
 * next renders.
 */
export function useFocusAfter() {
  const next = useRef<string[] | null>(null);
  useEffect(() => {
    if (!next.current) return;
    const found = next.current
      .map((s) => document.querySelector<HTMLElement>(s))
      .filter((x): x is HTMLElement => x !== null);
    const target = found.find((x) => !x.matches(":disabled"));
    if (!target && found.length > 0) return;
    next.current = null;
    target?.focus();
  });
  return (...selectors: string[]) => {
    next.current = selectors;
  };
}
