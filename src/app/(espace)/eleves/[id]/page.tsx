import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readStudent } from "@/db/students";
import { enrollmentsPaidBy } from "@/db/enrollments";
import { paymentsOf, balanceOf } from "@/db/payments";
import { nomAffiche } from "@/db/people";
import { currentSeason } from "@/db/schedule";
import { ageAt, todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { PaymentsSection } from "../../_people/payments-section";
import { Banner, FollowedCourses, Documents, BilledEnrollments, dayOf, Notes, Telephone } from "../../_people/sections";
import { Billing } from "./billing";
import { Relatives } from "./relatives";

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
  const donnees = await withSchool(schoolId, async (tx) => {
    const student = await readStudent(tx, id, today);
    if (!student) return null;
    const season = await currentSeason(tx, today);
    // An adult student who pays for themself sees their invoiced enrollments here.
    const paysForThemselves = student.billedTo.type !== "personne";
    return {
      student: student,
      season: season,
      billed: season ? await enrollmentsPaidBy(tx, student.id, season.id) : [],
      balance: paysForThemselves ? await balanceOf(tx, student.id, today) : null,
      payments: paysForThemselves ? await paymentsOf(tx, student.id) : [],
    };
  });
  if (!donnees) notFound();
  const { student: e, season: season, billed, balance: balance, payments: payments } = donnees;

  const name = nomAffiche(e);
  const firstName = e.firstName ?? name;
  const age = e.birthDate ? ageAt(e.birthDate, today) : null;
  const minor = age !== null && age < 18;
  const urgences = e.guardians
    .filter((r) => r.toNotify)
    .concat(e.otherRelationships.filter((a) => a.toNotify && a.sens === "vers"));
  const banner = BANNERS[String(inscription ?? enregistre)];

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/eleves" className="lien">
          Élèves
        </Link>
        <span className="text-doux"> / {name}</span>
      </nav>
      <Banner text={collected(encaisse) ?? banner} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titre-page">{name}</h1>
          <p className="text-sm text-doux">
            {e.birthDate ? `${age} ans, né(e) le ${dayOf(e.birthDate)}` : "Date de naissance non renseignée"}
            {!e.isStudent && " (contact : pas encore élève)"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/eleves/${e.id}/modifier`} className="bouton-secondaire">
            Modifier l’identité
          </Link>
          <Link href={`/eleves/${e.id}/inscription`} className="bouton-principal">
            Inscrire {firstName}
          </Link>
        </div>
      </header>

      <Notes notes={e.notes} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <aside
          aria-label="Contact et facturation"
          className="order-first flex flex-col gap-4 lg:sticky lg:top-20 lg:order-last"
        >
          <section aria-labelledby="urgence" className="panneau flex flex-col gap-1 p-4 text-sm">
            <h2 id="urgence" className="text-sm font-semibold">
              En cas d’urgence
            </h2>
            {urgences.length === 0 ? (
              <span className="text-doux">Personne à prévenir. Cochez « À prévenir » sur un responsable.</span>
            ) : (
              urgences.map((u) => (
                <span key={u.relationshipId} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{u.name}</span>
                  {u.telephone ? (
                    <Telephone number={u.telephone} />
                  ) : (
                    <span className="text-erreur">sans téléphone</span>
                  )}
                </span>
              ))
            )}
          </section>
          <Billing
            studentId={e.id}
            firstName={firstName}
            minor={minor}
            billedTo={e.billedTo}
            relatives={[...e.guardians, ...e.otherRelationships.filter((a) => a.sens === "vers")]}
            siblings={e.siblings}
          />
          <section aria-labelledby="coordonnees" className="panneau flex flex-col gap-1 p-4 text-sm">
            <h2 id="coordonnees" className="text-sm font-semibold">
              Coordonnées de {firstName}
            </h2>
            {e.telephone ? <Telephone number={e.telephone} /> : <span className="text-doux">Pas de téléphone</span>}
            {e.email ? (
              <a href={`mailto:${e.email}`} className="lien break-all">
                {e.email}
              </a>
            ) : (
              <span className="text-doux">Pas d’e-mail</span>
            )}
            {e.address && <span>{e.address}</span>}
          </section>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <Relatives studentId={e.id} firstName={firstName} guardians={e.guardians} other={e.otherRelationships} />
          <FollowedCourses courses={e.courses} />
          {season && <BilledEnrollments enrollments={billed} season={season.label} />}
          {e.billedTo.type === "personne" ? (
            <p className="text-sm text-doux">
              Paiements : sur la fiche de{" "}
              <Link href={`/contacts/${e.billedTo.id}`} className="lien">
                {e.billedTo.name}
              </Link>
              , qui paie pour {firstName}.
            </p>
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
