"use client";

import { CONNECTION_LOST } from "@/lib/action-result";
import { TextLink } from "./text-link";

/**
 * After `CONNECTION_LOST` (#257): the page where the user checks whether the
 * record was saved before retrying. Nothing for any other message.
 */
export function CheckSaved({
  message,
  href,
  label,
}: {
  message: string | null | undefined;
  href: string;
  label: string;
}) {
  if (message !== CONNECTION_LOST) return null;
  return (
    <TextLink href={href} size="sm">
      {label}
    </TextLink>
  );
}
