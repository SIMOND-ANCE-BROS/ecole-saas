import { Button, Text, Title } from "@mantine/core";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page introuvable" };

/** An address that matches no page (outside the workspace frame). */
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-start gap-3 px-4 py-16">
      <Title order={1} size="h2">
        Page introuvable
      </Title>
      <Text size="sm" c="dimmed">
        Cette adresse ne correspond à aucune page.
      </Text>
      <Button component="a" href="/">
        Retour à l’accueil
      </Button>
    </main>
  );
}
