import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readInstructor } from "@/db/instructors";
import { requireRole } from "@/lib/session";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { InstructorForm } from "../../instructor-form";

export const metadata: Metadata = { title: "Modifier un intervenant" };

export default async function UpdateInstructor({ params }: PageProps<"/intervenants/[id]/modifier">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { id } = await params;
  const instructor = await withSchool(schoolId, (tx) => readInstructor(tx, id));
  if (!instructor) notFound();
  const name = `${instructor.firstName} ${instructor.name}`;
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href="/intervenants" size="sm">
          Intervenants
        </TextLink>
        <span> / </span>
        <TextLink href={`/intervenants/${id}`} size="sm">
          {name}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Modifier
        </Text>
      </nav>
      <Title order={1} fz="xl">
        Modifier {name}
      </Title>
      <InstructorForm instructor={instructor} />
    </section>
  );
}
