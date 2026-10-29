import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { requireRole } from "@/lib/session";
import { BackToList } from "@/app/(espace)/_ui/list-return";
import { InstructorForm } from "../instructor-form";
import { FormPage } from "@/app/(espace)/_ui/form-page";

export const metadata: Metadata = { title: "Nouvel intervenant" };

export default async function NewInstructorPage() {
  await requireRole("director");
  return (
    <FormPage className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/intervenants" size="sm">
          Intervenants
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" "}
          / Nouveau
        </Text>
      </nav>
      <Title order={1} fz="xl">
        Nouvel intervenant
      </Title>
      <InstructorForm instructor={null} />
    </FormPage>
  );
}
