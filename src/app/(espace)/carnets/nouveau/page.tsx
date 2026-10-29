import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { entityChoices } from "@/db/billing-entities";
import { packGrid } from "@/db/lesson-packs";
import { displayedName, payableStudents, readPerson } from "@/db/people";
import { isStudent } from "@/db/students";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { FormPage } from "@/app/(espace)/_ui/form-page";
import { TextLink } from "../../_ui/text-link";
import { SaleForm } from "./sale-form";

export const metadata: Metadata = { title: "Vendre un carnet" };

/**
 * Sale of a private-lesson pack (#286) to a payer (`?payeur=`), for the students they
 * pay for; `?eleve=` is the student it was opened from, checked first. Also opened as
 * a side panel over the record.
 */
export default async function SellPackPage({ searchParams }: PageProps<"/carnets/nouveau">) {
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
            grid: await packGrid(tx, today),
            entities: await entityChoices(tx),
          };
        })
      : null;
  if (!parsed) notFound();
  const { payer, students, from, back, grid, entities } = parsed;
  const payerName = displayedName(payer);

  return (
    <FormPage className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href={back} size="sm">
          {from ? displayedName({ name: from.name, firstName: from.firstName, companyName: null }) : payerName}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Vendre un carnet
        </Text>
      </nav>
      <div>
        <Title order={1} fz="xl">
          Vendre un carnet
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
      ) : (
        <SaleForm
          payerId={payer.id}
          students={students.map((s) => ({ id: s.id, firstName: s.firstName, name: s.name }))}
          initialStudent={from?.id ?? (students.length === 1 ? students[0].id : null)}
          grid={grid}
          back={back}
          entities={entities}
        />
      )}
    </FormPage>
  );
}
