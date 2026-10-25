import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readStudent } from "@/db/students";
import { payableStudents, nomAffiche } from "@/db/people";
import { seasonCourses, currentSeason } from "@/db/schedule";
import { ageAt, todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { EnrollmentForm } from "./enrollment-form";

export const metadata: Metadata = { title: "Nouvelle inscription" };

/**
 * Enrollment of a student, invoiced to their payer (« Facturé à » on their record).
 * Their siblings, invoiced to the same person, can be enrolled right after.
 */
export default async function EnrollmentPage({ params }: PageProps<"/eleves/[id]/inscription">) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const { id } = await params;
  const today = todayInParis();
  const donnees = await withSchool(schoolId, async (tx) => {
    const student = await readStudent(tx, id, today);
    if (!student) return null;
    const payerId =
      student.billedTo.type === "person" ? student.billedTo.id : student.billedTo.type === "self" ? student.id : null;
    const season = await currentSeason(tx, today);
    return {
      student: student,
      payerId: payerId,
      season: season,
      students: payerId ? await payableStudents(tx, payerId) : [],
      courses: season ? await seasonCourses(tx, season.id) : [],
    };
  });
  if (!donnees) notFound();
  const { student: student, payerId: payerId, season: season, students: students, courses: cours } = donnees;
  const name = nomAffiche(student);
  const payer = student.billedTo.type === "person" ? student.billedTo.name : name;

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/eleves" className="lien">
          Élèves
        </Link>
        <span className="text-doux"> / </span>
        <Link href={`/eleves/${student.id}`} className="lien">
          {name}
        </Link>
        <span className="text-doux"> / Nouvelle inscription</span>
      </nav>
      <div>
        <h1 className="titre-page">Nouvelle inscription{season && ` ${season.label}`}</h1>
        {payerId && (
          <p className="text-sm text-doux">
            Facturée à {payer}. Pour changer, modifiez « Facturé à » sur la fiche de l’élève.
          </p>
        )}
      </div>
      {!season ? (
        <p className="text-sm">Aucune saison n’est paramétrée.</p>
      ) : !payerId ? (
        <p className="text-sm">
          {student.firstName ?? name} est mineur et n’a pas de payeur.{" "}
          <Link href={`/eleves/${student.id}`} className="lien">
            Indiquez à qui facturer sur sa fiche
          </Link>
          .
        </p>
      ) : (
        <EnrollmentForm
          payerId={payerId}
          students={students.map((d) => ({
            id: d.id,
            firstName: d.firstName,
            age: d.birthDate ? ageAt(d.birthDate, today) : null,
          }))}
          courses={cours}
          initialStudent={student.id}
        />
      )}
    </section>
  );
}
