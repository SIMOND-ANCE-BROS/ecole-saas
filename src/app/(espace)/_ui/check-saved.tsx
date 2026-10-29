"use client";

import { Text } from "@mantine/core";
import { CONNECTION_LOST } from "@/lib/action-result";
import { TextLink } from "./text-link";

/**
 * After `CONNECTION_LOST` (#257): the page where the user checks whether the
 * record was saved before retrying. Nothing for any other message.
 * `safeRetry`: the form sends a submission key (#260), so resending it
 * unchanged never records twice; the user is told so.
 */
export function CheckSaved({
  message,
  href,
  label,
  safeRetry = false,
}: {
  message: string | null | undefined;
  href: string;
  label: string;
  safeRetry?: boolean;
}) {
  if (message !== CONNECTION_LOST) return null;
  return (
    <>
      {safeRetry && <Text size="sm">Vous pouvez réessayer : un même envoi n’est jamais enregistré deux fois.</Text>}
      <TextLink href={href} size="sm">
        {label}
      </TextLink>
    </>
  );
}
