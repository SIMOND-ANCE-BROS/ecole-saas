"use client";

import { type ReactNode, useRef } from "react";
import { useInPanel } from "../_panel/panel";
import { useUnloadGuard, useUnsavedInput } from "./unsaved-input";

/**
 * The `<section>` of a full-page form (#258): reloading, closing the tab or typing
 * another address while it holds unsaved input gets the browser's own question.
 * Inside a side panel it is only a section: the panel guards its input itself.
 * The Back button is not guarded (see `Panel`).
 */
export function FormPage({ className, children }: { className?: string; children: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const inPanel = useRef(useInPanel());
  const holdsInput = useUnsavedInput(section);
  useUnloadGuard(holdsInput, inPanel);
  return (
    <section ref={section} className={className}>
      {children}
    </section>
  );
}
