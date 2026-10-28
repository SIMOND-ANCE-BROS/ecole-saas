import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { requireRole } from "@/lib/session";
import { PersonForm } from "../../_people/person-form";
import { BackToList } from "../../_ui/list-return";
import { TextLink } from "../../_ui/text-link";

export const metadata: Metadata = { title: "Nouveau contact" };

export default async function NewContactPage() {
  await requireRole("director", "front_desk");
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/contacts" size="sm">
          Contacts
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" "}
          / Nouveau contact
        </Text>
      </nav>
      <Title order={1} fz="xl">
        Nouveau contact
      </Title>
      <Text size="sm" c="dimmed">
        Pour un élève et son parent, utilisez plutôt{" "}
        <TextLink href="/eleves/nouveau" size="sm" inherit>
          « Nouvel élève »
        </TextLink>{" "}
        : le parent y est créé dans la foulée.
      </Text>
      <PersonForm person={null} section="contacts" />
    </section>
  );
}
