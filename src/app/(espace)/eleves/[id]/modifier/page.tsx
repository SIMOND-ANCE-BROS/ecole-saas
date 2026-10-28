import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readPerson, displayedName } from "@/db/people";
import { requireRole } from "@/lib/session";
import { PersonForm } from "../../../_people/person-form";
import { BackToList } from "../../../_ui/list-return";
import { TextLink } from "../../../_ui/text-link";

export const metadata: Metadata = { title: "Modifier un élève" };

export default async function EditStudentPage({ params }: PageProps<"/eleves/[id]/modifier">) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const { id } = await params;
  const record = await withSchool(schoolId, (tx) => readPerson(tx, id));
  if (!record) notFound();

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/eleves" size="sm">
          Élèves
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" / "}
        </Text>
        <TextLink href={`/eleves/${record.id}`} size="sm">
          {displayedName(record)}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Modifier
        </Text>
      </nav>
      <Title order={1} fz="xl">
        Modifier {displayedName(record)}
      </Title>
      <PersonForm person={record} section="eleves" />
    </section>
  );
}
