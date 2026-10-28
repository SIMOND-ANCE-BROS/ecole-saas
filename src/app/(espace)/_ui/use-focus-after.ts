"use client";

import { useEffect, useRef } from "react";

/**
 * Focus to move once the next render is on screen: an inline edit closes and
 * its row's « Modifier » button comes back (#186). Call it with a selector
 * just before the state change that brings the target back.
 */
export function useFocusAfter() {
  const next = useRef<string | null>(null);
  useEffect(() => {
    if (!next.current) return;
    const target = document.querySelector<HTMLElement>(next.current);
    next.current = null;
    target?.focus();
  });
  return (selector: string) => {
    next.current = selector;
  };
}
