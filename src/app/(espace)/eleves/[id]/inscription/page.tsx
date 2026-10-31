import type { Metadata } from "next";
import { Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { severalEntities } from "@/db/billing-entities";
import { readStudent } from "@/db/students";
import { payableStudents, displayedName } from "@/db/people";
import { takenCourses } from "@/db/enrollments";
import { answeredReferral, listReferralSources, payersRules } from "@/db/internal-rules";
import { seasonCourses, currentSeason } from "@/db/schedule";
import { ageAt, todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { BackToList } from "../../../_ui/list-return";
import { TextLink } from "../../../_ui/text-link";
import { EnrollmentForm } from "./enrollment-form";
import { FormPage } from "@/app/(espace)/_ui/form-page";

export const metadata: Metadata = { title: "Nouvelle inscription" };

/**
 * Enrollment of a student, invoiced to their payer (« Facturé à » on their record).
 * Their siblings, invoiced to the same person, can be enrolled right after.
 */
export default async function EnrollmentPage({ params }: PageProps<"/eleves/[id]/inscription">) {
  const { schoolId } = await requireRole("director", "front_desk");
  const { id } = await params;
  const today = todayInParis();
  const parsed = await withSchool(schoolId, async (tx) => {
    const student = await readStudent(tx, id, today);
    if (!student) return null;
    const payerId =
      student.billedTo.type === "person" ? student.billedTo.id : student.billedTo.type === "self" ? student.id : null;
    const season = await currentSeason(tx, today);
    const students = payerId ? await payableStudents(tx, payerId) : [];
    return {
      student,
      payerId,
      season,
      students,
      courses: season ? await seasonCourses(tx, season.id) : [],
      // Courses each student already takes this season (#333): marked « déjà inscrit » in the form.
      taken: season
        ? await takenCourses(
            tx,
            students.map((d) => d.id),
            season.id,
          )
        : [],
      severalEntities: await severalEntities(tx),
      // #296: whether the payer already signed the season's rules, and who still has to say how they heard of us.
      rules: season && payerId ? ((await payersRules(tx, [payerId], season.id))[0] ?? null) : null,
      referrals: await listReferralSources(tx),
      answered: await answeredReferral(
        tx,
        students.map((d) => d.id),
      ),
    };
  });
  if (!parsed) notFound();
  const { student, payerId, season, students, courses } = parsed;
  const name = displayedName(student);
  const payer = student.billedTo.type === "person" ? student.billedTo.name : name;

  return (
    <FormPage className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/eleves" size="sm">
          Élèves
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" / "}
        </Text>
        <TextLink href={`/eleves/${student.id}`} size="sm">
          {name}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Nouvelle inscription
        </Text>
      </nav>
      <div>
        <Title order={1} fz="xl">
          Nouvelle inscription{season && ` ${season.label}`}
        </Title>
        {payerId && (
          <Text size="sm" c="dimmed">
            Facturée à {payer}. Pour changer, modifiez « Facturé à » sur la fiche de l’élève.
          </Text>
        )}
      </div>
      {!season ? (
        <Text size="sm">Aucune saison n’est paramétrée.</Text>
      ) : !payerId ? (
        <Text size="sm">
          {student.firstName ?? name} est mineur et n’a pas de payeur.{" "}
          <TextLink href={`/eleves/${student.id}`} size="sm" inherit>
            Indiquez à qui facturer sur sa fiche
          </TextLink>
          .
        </Text>
      ) : (
        <EnrollmentForm
          payerId={payerId}
          students={students.map((d) => ({
            id: d.id,
            firstName: d.firstName,
            age: d.birthDate ? ageAt(d.birthDate, today) : null,
          }))}
          courses={courses}
          taken={parsed.taken}
          initialStudent={student.id}
          severalEntities={parsed.severalEntities}
          rulesAcceptedOn={parsed.rules?.acceptedOn ?? null}
          rulesRecorded={parsed.rules?.rulesRecorded ?? false}
          referrals={parsed.referrals.map((r) => ({ id: r.id, label: r.label }))}
          answered={parsed.answered}
        />
      )}
    </FormPage>
  );
}
