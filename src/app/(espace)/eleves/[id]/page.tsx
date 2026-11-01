import type { Metadata } from "next";
import { Anchor, Badge, Paper, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readStudent } from "@/db/students";
import { seasonEnrollments } from "@/db/enrollments";
import { paymentsOf, balanceOf } from "@/db/payments";
import { packsOf } from "@/db/lesson-packs";
import { severalEntities } from "@/db/billing-entities";
import { payerInvoices } from "@/db/payer-invoices";
import { mayDraft } from "@/domain/invoicing/progress";
import { InvoicesSection } from "../../_people/invoices-section";
import { displayedName } from "@/db/people";
import { currentSeason } from "@/db/schedule";
import { enrolledCourses, firstEnrollmentDate, readRequirements, studentDocuments } from "@/db/student-documents";
import { ageAt, isMinor, todayInParis } from "@/domain/people/age";
import { documentsToBring, documentState, expectedDocuments, recordableDocuments } from "@/domain/people/documents";
import { ofName } from "@/lib/french";
import { requireRole } from "@/lib/session";
import { PaymentsSection } from "../../_people/payments-section";
import { mayRefund } from "@/domain/payments/refund";
import { mayCancelRefund } from "@/domain/payments/refund-cancellation";
import { LessonPacks } from "../../_people/lesson-packs";
import { Banner, FollowedCourses, Enrollments, dayOf, Notes, Telephone } from "../../_people/sections";
import { Billing } from "./billing";
import { type DocumentLine, Documents } from "./documents";
import { Relatives } from "./relatives";
import { RulesSection } from "../../_people/rules-section";
import { currentRulesVersion, listReferralSources, studentChoices, studentRulesLines } from "@/db/internal-rules";
import { defaultAcceptedOn } from "@/domain/people/internal-rules";
import { ButtonLink } from "../../_ui/button-link";
import { BackToList } from "../../_ui/list-return";
import { TextLink } from "../../_ui/text-link";

export const metadata: Metadata = { title: "Fiche élève" };

const BANNERS: Record<string, string> = {
  cree: "Élève créé.",
  modifie: "Fiche enregistrée.",
  enregistree: "Inscription enregistrée.",
  // One submission over two businesses (#299): one enrollment each.
  enregistrees: "Inscriptions enregistrées, une par entreprise.",
  vendu: "Carnet vendu.",
};

/** Banner after a payment (`?encaisse=3`). */
const collected = (n: unknown) => {
  const k = Number(n);
  return Number.isInteger(k) && k > 0 ? `${k} règlement${k > 1 ? "s" : ""} encaissé${k > 1 ? "s" : ""}.` : undefined;
};

export default async function StudentPage({ params, searchParams }: PageProps<"/eleves/[id]">) {
  const { schoolId: schoolId, role } = await requireRole("director", "front_desk");
  const [{ id }, { enregistre, inscription, encaisse, carnet }] = await Promise.all([params, searchParams]);
  const today = todayInParis();
  const parsed = await withSchool(schoolId, async (tx) => {
    const student = await readStudent(tx, id, today);
    if (!student) return null;
    const season = await currentSeason(tx, today);
    const paysForThemselves = student.billedTo.type !== "person";
    return {
      student: student,
      season: season,
      // The student's enrollments, and the ones they pay for (an adult paying for their child).
      enrollments: season ? await seasonEnrollments(tx, { personId: student.id }, season.id) : [],
      balance: paysForThemselves ? await balanceOf(tx, student.id, today) : null,
      payments: paysForThemselves ? await paymentsOf(tx, student.id) : [],
      requirements: await readRequirements(tx),
      documents: await studentDocuments(tx, student.id),
      enrolledOn: season ? await firstEnrollmentDate(tx, student.id, season.id) : null,
      courses: season ? await enrolledCourses(tx, student.id, season.id) : [],
      packs: await packsOf(tx, { personId: student.id }),
      // A student paying for themselves: their own invoices (#352).
      invoices: season && paysForThemselves ? await payerInvoices(tx, student.id, season.id) : [],
      severalEntities: await severalEntities(tx),
      // Internal rules, photos and « Comment nous avez-vous connus ? » (#296).
      rules: season
        ? await studentRulesLines(
            tx,
            student.id,
            student.billedTo.type === "person"
              ? student.billedTo.id
              : student.billedTo.type === "self"
                ? student.id
                : null,
            season.id,
          )
        : [],
      rulesRecorded: season ? (await currentRulesVersion(tx, season.id)) !== null : false,
      choices: await studentChoices(tx, student.id),
      referrals: await listReferralSources(tx),
    };
  });
  if (!parsed) notFound();
  const { student: e, season: season, enrollments, balance: balance, payments: payments } = parsed;
  const { requirements, documents, enrolledOn, courses, packs } = parsed;
  const toBring = documentsToBring({ requirements, documents, birthDate: e.birthDate, enrolledOn, today, courses });
  const expected = expectedDocuments(requirements, e.birthDate, today, courses);
  // Documents the school may ask of this student (an adult hands in a certificate before enrolling), and any other recorded.
  const recordable = recordableDocuments(requirements, e.birthDate, today);
  const documentLines: DocumentLine[] = requirements.flatMap((r) => {
    const doc = documents.find((d) => d.type === r.type) ?? null;
    if (!recordable.includes(r.type) && !doc) return [];
    return [
      {
        type: r.type,
        expected: expected.includes(r.type),
        state: documentState(doc ?? undefined, today),
        doc,
        due: toBring.find((d) => d.type === r.type) ?? null,
        validityMonths: r.validityMonths,
      },
    ];
  });

  const name = displayedName(e);
  const firstName = e.firstName ?? name;
  const age = e.birthDate ? ageAt(e.birthDate, today) : null;
  const minor = isMinor(e.birthDate, today);
  const emergencyContacts = e.guardians
    .filter((r) => r.toNotify)
    .concat(e.otherRelationships.filter((a) => a.toNotify && a.direction === "incoming"));
  const banner = BANNERS[String(inscription ?? carnet ?? enregistre)];
  // Who pays a pack sold from this record: the student's payer, or themselves.
  const packPayer = e.billedTo.type === "person" ? e.billedTo.id : e.billedTo.type === "self" ? e.id : null;

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/eleves" size="sm">
          Élèves
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" "}
          / {name}
        </Text>
      </nav>
      <Banner text={collected(encaisse) ?? banner} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Title order={1} fz="xl">
            {name}
          </Title>
          <Text size="sm" c="dimmed">
            {e.birthDate ? `${age} ans, né(e) le ${dayOf(e.birthDate)}` : "Date de naissance non renseignée"}
            {!e.isStudent && " (contact : pas encore élève)"}
          </Text>
          {parsed.choices?.refusesPhotos && (
            // Seen at once by whoever opens the record before a photo or the gala (#296).
            <Badge color="yellow" variant="light" radius="sm" tt="none" mt={4}>
              Refuse les photos
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/eleves/${e.id}/modifier`} variant="default">
            Modifier l’identité
          </ButtonLink>
          <ButtonLink href={`/eleves/${e.id}/inscription`}>Inscrire {firstName}</ButtonLink>
        </div>
      </header>

      <Notes notes={e.notes} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <aside
          aria-label="Contact et facturation"
          className="order-first flex flex-col gap-4 lg:sticky lg:top-20 lg:order-last"
        >
          <Paper
            withBorder
            p="md"
            component="section"
            aria-labelledby="urgence"
            className="flex flex-col gap-1 text-sm"
          >
            <Title order={2} size="h6" id="urgence">
              En cas d’urgence
            </Title>
            {emergencyContacts.length === 0 ? (
              <Text span size="sm" c="dimmed">
                Aucune personne à prévenir. Cochez « À prévenir » sur un responsable.
              </Text>
            ) : (
              emergencyContacts.map((u) => (
                <span key={u.relationshipId} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{u.name}</span>
                  {u.telephone ? (
                    <Telephone number={u.telephone} />
                  ) : (
                    <Text span size="sm" c="red">
                      sans téléphone
                    </Text>
                  )}
                </span>
              ))
            )}
          </Paper>
          <Billing
            studentId={e.id}
            firstName={firstName}
            minor={minor}
            billedTo={e.billedTo}
            relatives={[...e.guardians, ...e.otherRelationships.filter((a) => a.direction === "incoming")]}
            siblings={e.siblings}
          />
          <Paper
            withBorder
            p="md"
            component="section"
            aria-labelledby="coordonnees"
            className="flex flex-col gap-1 text-sm"
          >
            <Title order={2} size="h6" id="coordonnees">
              Coordonnées {ofName(firstName)}
            </Title>
            {e.telephone ? (
              <Telephone number={e.telephone} />
            ) : (
              <Text span size="sm" c="dimmed">
                Pas de téléphone
              </Text>
            )}
            {e.email ? (
              <Anchor href={`mailto:${e.email}`} size="sm" className="break-all">
                {e.email}
              </Anchor>
            ) : (
              <Text span size="sm" c="dimmed">
                Pas d’e-mail
              </Text>
            )}
            {e.address && <span>{e.address}</span>}
          </Paper>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <Relatives studentId={e.id} firstName={firstName} guardians={e.guardians} other={e.otherRelationships} />
          <FollowedCourses courses={e.courses} />
          {season && (
            <Enrollments
              enrollments={enrollments}
              season={season}
              today={today}
              payerId={e.billedTo.type !== "person" ? e.id : null}
            />
          )}
          <LessonPacks
            packs={packs}
            personId={e.id}
            sellHref={packPayer ? `/carnets/nouveau?payeur=${packPayer}&eleve=${e.id}` : null}
            noPayer={!packPayer}
          />
          {e.billedTo.type === "person" ? (
            <Text size="sm" c="dimmed">
              Paiements : sur la fiche de{" "}
              <TextLink href={`/contacts/${e.billedTo.id}`} size="sm" inherit>
                {e.billedTo.name}
              </TextLink>
              , qui paie pour {firstName}.
            </Text>
          ) : (
            <>
              {season && (enrollments.length > 0 || packs.length > 0 || parsed.invoices.length > 0) && (
                <InvoicesSection
                  payerId={e.id}
                  season={season}
                  invoices={parsed.invoices}
                  showEntity={parsed.severalEntities}
                  canDraft={mayDraft(role)}
                  isDirector={role === "director"}
                />
              )}
              <PaymentsSection
                payerId={e.id}
                balance={balance}
                payments={payments}
                back={`/eleves/${e.id}`}
                isDirector={role === "director"}
                canRefund={mayRefund(role)}
                canCancelRefund={mayCancelRefund(role)}
                today={today}
              />
            </>
          )}
          <Documents
            studentId={e.id}
            firstName={firstName}
            lines={documentLines}
            enrolled={enrolledOn !== null}
            today={today}
            isDirector={role === "director"}
          />
          {season && e.isStudent && (
            <RulesSection
              seasonLabel={season.label}
              rulesRecorded={parsed.rulesRecorded}
              lines={parsed.rules.map((r) => ({
                payerId: r.payerId,
                payerName: r.payerName,
                enrolled: r.enrolled && r.rulesRecorded,
                acceptedOn: r.acceptedOn,
                defaultOn: defaultAcceptedOn(r.firstEnrolledOn, today),
                olderVersion: r.olderVersion,
              }))}
              today={today}
              student={{
                studentId: e.id,
                refusesPhotos: parsed.choices?.refusesPhotos ?? false,
                referralId: parsed.choices?.referralId ?? null,
                referrals: parsed.referrals.map((r) => ({ id: r.id, label: r.label })),
              }}
              isDirector={role === "director"}
            />
          )}
        </div>
      </div>
    </article>
  );
}
