"use client";

import { Button, type ButtonProps } from "@mantine/core";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Mantine button that navigates with Next (#115), usable from a server page
 * like `TextLink`: an action that opens another page (« Modifier le cours »).
 */
export function ButtonLink({ href, children, ...props }: ButtonProps & { href: string; children: ReactNode }) {
  return (
    <Button component={Link} href={href} {...props}>
      {children}
    </Button>
  );
}
