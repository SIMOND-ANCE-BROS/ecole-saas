"use client";

import { type AnchorProps } from "@mantine/core";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { isRememberedList, listAddress, listReturn, returnKey, type RememberedList } from "@/lib/list-return";
import { TextLink } from "./text-link";

/**
 * Remembers the list's address as shown (filters, sort, search) for
 * « Retour à la liste » (#107). Per tab (sessionStorage); storage may be
 * unavailable (private window, blocked site data): nothing is remembered then.
 */
export function RememberList({ list }: { list: RememberedList }) {
  // A side panel opened over the list changes the address, not the list: not saved.
  const shown = usePathname() === list;
  const query = useSearchParams().toString();
  useEffect(() => {
    if (!shown) return;
    try {
      sessionStorage.setItem(returnKey(list), listAddress(list, query));
    } catch {
      // Storage unavailable: the back link leads to the bare list.
    }
  }, [list, query, shown]);
  return null;
}

const noSubscription = () => () => {};

/**
 * The address a link to `href` should use: for a remembered list, its last
 * address in this tab; any other `href` as is. The server and the first render
 * use `href`, so hydration matches.
 */
export function useListReturn(href: string): string {
  return useSyncExternalStore(
    noSubscription,
    () => {
      if (!isRememberedList(href)) return href;
      try {
        return listReturn(href, sessionStorage.getItem(returnKey(href)));
      } catch {
        return href;
      }
    },
    () => href,
  );
}

/** Link back to a list, with the filters and sort it had (#107). */
export function BackToList({ list, children, ...props }: AnchorProps & { list: RememberedList; children: ReactNode }) {
  return (
    <TextLink href={useListReturn(list)} {...props}>
      {children}
    </TextLink>
  );
}
