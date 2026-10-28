import type { Metadata } from "next";
import { Anchor, Paper, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readStudent } from "@/db/students";
import { enrollmentsPaidBy } from "@/db/enrollments";
import { paymentsOf, balanceOf } from "@/db/payments";
import { displayedName } from "@/db/people";
import { currentSeason } from "@/db/schedule";
import { ageAt, isMinor, todayInParis } from "@/domain/people/age";
import { ofName } from "@/lib/french";
import { requireRole } from "@/lib/session";
import { PaymentsSection } from "../../_people/payments-section";
import { Banner, FollowedCourses, Documents, BilledEnrollments, dayOf, Notes, Telephone } from "../../_people/sections";
import { Billing } from "./billing";
import { Relatives } from "./relatives";
import { ButtonLink } from "../../_ui/button-link";
import { TextLink } from "../../_ui/text-link";

export const metadata: Metadata = { title: "Fiche élève" };

const BANNERS: Record<string, string> = {
  cree: "Élève créé.",
  modifie: "Fiche enregistrée.",
  enregistree: "Inscription enregistrée.",
};

/** Banner after a payment (`?encaisse=3`). */
const collected = (n: unknown) => {
  const k = Number(n);
  return Number.isInteger(k) && k > 0 ? `${k} règlement${k > 1 ? "s" : ""} encaissé${k > 1 ? "s" : ""}.` : undefined;
};

export default async function StudentPage({ params, searchParams }: PageProps<"/eleves/[id]">) {
  const { schoolId: schoolId, role } = await requireRole("director", "front_desk");
  const [{ id }, { enregistre, inscription, encaisse }] = await Promise.all([params, searchParams]);
  const today = todayInParis();
  const parsed = await withSchool(schoolId, async (tx) => {
    const student = await readStudent(tx, id, today);
    if (!student) return null;
    const season = await currentSeason(tx, today);
    // An adult student who pays for themself sees their invoiced enrollments here.
    const paysForThemselves = student.billedTo.type !== "person";
    return {
      student: student,
      season: season,
      billed: season ? await enrollmentsPaidBy(tx, student.id, season.id) : [],
      balance: paysForThemselves ? await balanceOf(tx, student.id, today) : null,
      payments: paysForThemselves ? await paymentsOf(tx, student.id) : [],
    };
  });
  if (!parsed) notFound();
  const { student: e, season: season, billed, balance: balance, payments: payments } = parsed;

  const name = displayedName(e);
  const firstName = e.firstName ?? name;
  const age = e.birthDate ? ageAt(e.birthDate, today) : null;
  const minor = isMinor(e.birthDate, today);
  const emergencyContacts = e.guardians
    .filter((r) => r.toNotify)
    .concat(e.otherRelationships.filter((a) => a.toNotify && a.direction === "incoming"));
  const banner = BANNERS[String(inscription ?? enregistre)];

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href="/eleves" size="sm">
          Élèves
        </TextLink>
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
          {season && <BilledEnrollments enrollments={billed} season={season.label} />}
          {e.billedTo.type === "person" ? (
            <Text size="sm" c="dimmed">
              Paiements : sur la fiche de{" "}
              <TextLink href={`/contacts/${e.billedTo.id}`} size="sm" inherit>
                {e.billedTo.name}
              </TextLink>
              , qui paie pour {firstName}.
            </Text>
          ) : (
            <PaymentsSection
              payerId={e.id}
              balance={balance}
              payments={payments}
              back={`/eleves/${e.id}`}
              isDirector={role === "director"}
              today={today}
            />
          )}
          <Documents documents={e.documents} today={today} />
        </div>
      </div>
    </article>
  );
}
