import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { readPerson, displayedName } from "@/db/people";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { BackToList } from "../../_ui/list-return";
import { NewStudentGuide } from "./guide";
import { FormPage } from "@/app/(espace)/_ui/form-page";

export const metadata: Metadata = { title: "Nouvel élève" };

/** `?responsable=<id>`: from a contact's record (« Ajouter un enfant »), the guardian is already chosen. */
export default async function NewStudentPage({ searchParams }: PageProps<"/eleves/nouveau">) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const { responsable } = await searchParams;
  const r = typeof responsable === "string" ? await withSchool(schoolId, (tx) => readPerson(tx, responsable)) : null;
  return (
    <FormPage className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/eleves" size="sm">
          Élèves
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" "}
          / Nouvel élève
        </Text>
      </nav>
      <Title order={1} fz="xl">
        Nouvel élève
      </Title>
      <NewStudentGuide today={todayInParis()} initialGuardian={r ? { id: r.id, name: displayedName(r) } : undefined} />
    </FormPage>
  );
}
