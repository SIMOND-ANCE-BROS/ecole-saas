"use client";

import { useEffect, useRef } from "react";

/**
 * Focus to move once the next render is on screen: an inline edit closes and
 * its row's « Modifier » button comes back, or a removed row's list takes it
 * (#186). Call it just before the state change that brings the target back;
 * the first selector that matches wins.
 */
export function useFocusAfter() {
  const next = useRef<string[] | null>(null);
  useEffect(() => {
    if (!next.current) return;
    const target = next.current.map((s) => document.querySelector<HTMLElement>(s)).find(Boolean);
    next.current = null;
    target?.focus();
  });
  return (...selectors: string[]) => {
    next.current = selectors;
  };
}
