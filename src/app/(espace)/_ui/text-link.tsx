"use client";

import { Anchor, type AnchorProps } from "@mantine/core";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Mantine link with Next navigation (#115). A server page cannot hand `Link`
 * to `Anchor` itself (a function does not cross to the client): it uses this.
 */
export function TextLink({ href, children, ...props }: AnchorProps & { href: string; children: ReactNode }) {
  return (
    <Anchor component={Link} href={href} {...props}>
      {children}
    </Anchor>
  );
}
