import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { severalEntities } from "@/db/billing-entities";
import { displayedName, payableStudents, readPerson } from "@/db/people";
import { isStudent } from "@/db/students";
import { workshopChoices } from "@/db/workshops";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { FormPage } from "@/app/(espace)/_ui/form-page";
import { TextLink } from "../../_ui/text-link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Inscrire à un stage" };

/**
 * Sign-up for a workshop (#297) by a payer (`?payeur=`), for the students they pay for;
 * `?eleve=` is the student it was opened from, ticked first. Also opened as a side panel
 * over the record.
 */
export default async function WorkshopSignupPage({ searchParams }: PageProps<"/stages/nouveau">) {
  const { schoolId } = await requireRole("director", "front_desk");
  const { payeur, eleve } = await searchParams;
  const today = todayInParis();
  const parsed =
    typeof payeur === "string"
      ? await withSchool(schoolId, async (tx) => {
          const payer = await readPerson(tx, payeur);
          if (!payer) return null;
          const students = await payableStudents(tx, payer.id);
          const from = typeof eleve === "string" ? students.find((s) => s.id === eleve) : undefined;
          return {
            payer,
            students,
            from,
            back: from
              ? `/eleves/${from.id}`
              : `/${(await isStudent(tx, payer.id)) ? "eleves" : "contacts"}/${payer.id}`,
            workshops: await workshopChoices(tx, today),
            showEntity: await severalEntities(tx),
          };
        })
      : null;
  if (!parsed) notFound();
  const { payer, students, from, back, workshops, showEntity } = parsed;
  const payerName = displayedName(payer);

  return (
    <FormPage className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href={back} size="sm">
          {from ? displayedName({ name: from.name, firstName: from.firstName, companyName: null }) : payerName}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Inscrire à un stage
        </Text>
      </nav>
      <div>
        <Title order={1} fz="xl">
          Inscrire à un stage
        </Title>
        <Text size="sm" c="dimmed">
          {/* Non-breaking spaces inside « »: the quotes never end a line on a phone. */}
          Facturé à {payerName}.{from && " Pour changer, modifiez « Facturé à » sur la fiche de l’élève."}
        </Text>
      </div>
      {students.length === 0 ? (
        <Text size="sm">
          {payerName} ne paie pour aucun élève. Choisissez «&nbsp;Facturé à&nbsp;» sur la fiche de l’élève.
        </Text>
      ) : workshops.length === 0 ? (
        <Text size="sm">
          Aucun stage cette saison. Créez-le d’abord dans le planning (type «&nbsp;Stage&nbsp;»), avec son prix par
          participant.
        </Text>
      ) : (
        <SignupForm
          payerId={payer.id}
          students={students.map((s) => ({ id: s.id, firstName: s.firstName, name: s.name }))}
          initialStudent={from?.id ?? (students.length === 1 ? students[0].id : null)}
          workshops={workshops}
          showEntity={showEntity}
          back={back}
        />
      )}
    </FormPage>
  );
}
