import { Text, Title } from "@mantine/core";
import { TextLink } from "../_ui/text-link";

/** Breadcrumb and title of a settings section. */
export function SettingsHeader({ title: title, help: help }: { title: string; help: string }) {
  return (
    <>
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href="/parametres" size="sm">
          Paramètres
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / {title}
        </Text>
      </nav>
      <div>
        <Title order={1} fz="xl">
          {title}
        </Title>
        <Text size="sm" c="dimmed">
          {help}
        </Text>
      </div>
    </>
  );
}
