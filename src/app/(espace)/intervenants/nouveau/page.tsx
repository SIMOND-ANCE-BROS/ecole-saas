import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { requireRole } from "@/lib/session";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { InstructorForm } from "../instructor-form";

export const metadata: Metadata = { title: "Nouvel intervenant" };

export default async function NewInstructorPage() {
  await requireRole("director");
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href="/intervenants" size="sm">
          Intervenants
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Nouveau
        </Text>
      </nav>
      <Title order={1} fz="xl">
        Nouvel intervenant
      </Title>
      <InstructorForm instructor={null} />
    </section>
  );
}
