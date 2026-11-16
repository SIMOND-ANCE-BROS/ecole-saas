import type { Metadata } from "next";
import { Alert, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { severalEntities } from "@/db/billing-entities";
import { readStudent } from "@/db/students";
import { payableStudents, displayedName } from "@/db/people";
import { takenCourses } from "@/db/enrollments";
import { answeredReferral, listReferralSources, payersRules } from "@/db/internal-rules";
import { seasonCourses, currentSeason, seasonById } from "@/db/schedule";
import { hasTariffGrid } from "@/db/tariffs";
import { ageAt, todayInParis } from "@/domain/people/age";
import { enrollSeasonRefusal } from "@/domain/enrollment/season";
import { requireRole } from "@/lib/session";
import { BackToList } from "../../../_ui/list-return";
import { TextLink } from "../../../_ui/text-link";
import { seasonParam, withSeason } from "../../../planning/season-link";
import { EnrollmentForm } from "./enrollment-form";
import { FormPage } from "@/app/(espace)/_ui/form-page";

export const metadata: Metadata = { title: "Nouvelle inscription" };

/** `?saison=<id>` (#376): the season the record shows, the current one when absent. */
const validSearch = z.object({ saison: z.uuid().optional() });

/**
 * Enrollment of a student, invoiced to their payer (« Facturé à » on their record), in the
 * season their record shows: the current one or a later one (#376, re-enrollments in June).
 * Their siblings, invoiced to the same person, can be enrolled right after.
 */
export default async function EnrollmentPage({ params, searchParams }: PageProps<"/eleves/[id]/inscription">) {
  const { schoolId, role } = await requireRole("director", "front_desk");
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const asked = validSearch.safeParse(search);
  if (!asked.success) notFound();
  const today = todayInParis();
  const parsed = await withSchool(schoolId, async (tx) => {
    const student = await readStudent(tx, id, today);
    if (!student) return null;
    const payerId =
      student.billedTo.type === "person" ? student.billedTo.id : student.billedTo.type === "self" ? student.id : null;
    const current = await currentSeason(tx, today);
    // Another school's or an unknown season (RLS): no such page.
    const season = asked.data.saison ? await seasonById(tx, asked.data.saison) : current;
    if (asked.data.saison && !season) return null;
    // A past season takes no new enrollment (#376 Q1): said instead of the form.
    const refusal = season && current ? enrollSeasonRefusal(season, current) : null;
    const open = season && !refusal ? season : null;
    const students = payerId ? await payableStudents(tx, payerId) : [];
    return {
      student,
      payerId,
      season,
      current,
      refusal,
      students,
      courses: open ? await seasonCourses(tx, open.id) : [],
      // #376 Q2: a season without a tariff grid yet keeps the form, which says so.
      hasGrid: open ? await hasTariffGrid(tx, open.id) : true,
      // Courses each student already takes this season (#333): marked « déjà inscrit » in the form.
      taken: open
        ? await takenCourses(
            tx,
            students.map((d) => d.id),
            open.id,
          )
        : [],
      severalEntities: await severalEntities(tx),
      // #296: whether the payer already signed the season's rules, and who still has to say how they heard of us.
      rules: open && payerId ? ((await payersRules(tx, [payerId], open.id))[0] ?? null) : null,
      referrals: await listReferralSources(tx),
      answered: await answeredReferral(
        tx,
        students.map((d) => d.id),
      ),
    };
  });
  if (!parsed) notFound();
  const { student, payerId, season, current, refusal, students, courses } = parsed;
  const name = displayedName(student);
  const payer = student.billedTo.type === "person" ? student.billedTo.name : name;
  // Back to the record on the season it showed.
  const record = withSeason(
    `/eleves/${student.id}`,
    season && current ? seasonParam(season.id, current.id) : undefined,
  );

  return (
    <FormPage className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/eleves" size="sm">
          Élèves
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" / "}
        </Text>
        <TextLink href={record} size="sm">
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
        {payerId && !refusal && (
          <Text size="sm" c="dimmed">
            Facturée à {payer}. Pour changer, modifiez « Facturé à » sur la fiche de l’élève.
          </Text>
        )}
      </div>
      {!season ? (
        <Text size="sm">Aucune saison n’est paramétrée.</Text>
      ) : refusal ? (
        <Text size="sm">
          {refusal}{" "}
          <TextLink href={record} size="sm" inherit className="inline-link">
            Revenir à la fiche
          </TextLink>
          .
        </Text>
      ) : !payerId ? (
        <Text size="sm">
          {student.firstName ?? name} est mineur et n’a pas de payeur.{" "}
          <TextLink href={record} size="sm" inherit className="inline-link">
            Indiquez à qui facturer sur sa fiche
          </TextLink>
          .
        </Text>
      ) : (
        <>
          {!parsed.hasGrid && (
            <Alert color="yellow" title={`Pas encore de grille tarifaire pour ${season.label}`}>
              <Text size="sm">
                Aucun prix ne se calcule : saisissez le prix de chaque inscription, avec son motif.{" "}
                {role === "director" ? (
                  <>
                    Pour que les prix se calculent,{" "}
                    <TextLink
                      href={`/parametres/tarifs?saison=${encodeURIComponent(season.id)}`}
                      size="sm"
                      inherit
                      className="inline-link"
                    >
                      saisissez la grille de {season.label}
                    </TextLink>
                    .
                  </>
                ) : (
                  "Pour que les prix se calculent, la direction saisit la grille dans Paramètres › Tarifs."
                )}
              </Text>
            </Alert>
          )}
          <EnrollmentForm
            payerId={payerId}
            seasonId={season.id}
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
        </>
      )}
    </FormPage>
  );
}
