import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readContact } from "@/db/students";
import { enrollmentsPaidBy } from "@/db/enrollments";
import { paymentsOf, balanceOf } from "@/db/payments";
import { nomAffiche } from "@/db/people";
import { currentSeason } from "@/db/schedule";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { Banner, BilledEnrollments, Telephone } from "../../_people/sections";
import { PaymentsSection } from "../../_people/payments-section";
import { BecomeStudent } from "./become-student";

export const metadata: Metadata = { title: "Fiche contact" };

const BANNERS: Record<string, string> = { cree: "Contact créé.", modifie: "Fiche enregistrée." };

/** Banner after a payment (`?encaisse=3`). */
const collected = (n: unknown) => {
  const k = Number(n);
  return Number.isInteger(k) && k > 0 ? `${k} règlement${k > 1 ? "s" : ""} encaissé${k > 1 ? "s" : ""}.` : undefined;
};

export default async function PageContact({ params, searchParams }: PageProps<"/contacts/[id]">) {
  const { schoolId: schoolId, role } = await requireRole("director", "front_desk");
  const [{ id }, { enregistre, encaisse }] = await Promise.all([params, searchParams]);
  const today = todayInParis();
  const donnees = await withSchool(schoolId, async (tx) => {
    const contact = await readContact(tx, id);
    if (!contact) return null;
    const season = await currentSeason(tx, today);
    return {
      contact,
      season: season,
      billed: season ? await enrollmentsPaidBy(tx, contact.id, season.id) : [],
      balance: await balanceOf(tx, contact.id, today),
      payments: await paymentsOf(tx, contact.id),
    };
  });
  if (!donnees) notFound();
  const { contact: c, season: season, billed, balance: balance, payments: payments } = donnees;
  const name = nomAffiche(c);
  const firstName = c.firstName ?? name;
  const roles = (e: (typeof c.students)[number]) =>
    [e.guardian && "responsable", e.paysFor && "facturé", e.toNotify && "à prévenir"].filter(Boolean).join(", ") ||
    "proche";

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/contacts" className="lien">
          Contacts
        </Link>
        <span className="text-doux"> / {name}</span>
      </nav>
      <Banner text={collected(encaisse) ?? BANNERS[String(enregistre)]} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titre-page">{name}</h1>
          <p className="text-sm text-doux">
            {c.type === "professionnel" ? `Organisme${c.siren ? `, SIREN ${c.siren}` : ""}` : "Particulier"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/contacts/${c.id}/modifier`} className="bouton-secondaire">
            Modifier
          </Link>
          {c.type === "particulier" &&
            (c.isStudent ? (
              <Link href={`/eleves/${c.id}`} className="bouton-secondaire">
                Voir sa fiche élève
              </Link>
            ) : (
              <BecomeStudent id={c.id} firstName={firstName} />
            ))}
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <aside aria-label="Coordonnées" className="order-first lg:order-last">
          <section aria-labelledby="coordonnees" className="panneau flex flex-col gap-1 p-4 text-sm">
            <h2 id="coordonnees" className="text-sm font-semibold">
              Coordonnées
            </h2>
            {c.telephone ? <Telephone number={c.telephone} /> : <span className="text-doux">Pas de téléphone</span>}
            {c.email ? (
              <a href={`mailto:${c.email}`} className="lien break-all">
                {c.email}
              </a>
            ) : (
              <span className="text-doux">Pas d’e-mail</span>
            )}
            {c.address && <span>{c.address}</span>}
          </section>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="eleves" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="eleves" className="text-base font-semibold">
                Élèves
              </h2>
              {c.type === "particulier" && (
                <Link href={`/eleves/nouveau?responsable=${c.id}`} className="lien text-sm">
                  Ajouter un enfant
                </Link>
              )}
            </div>
            {c.students.length === 0 ? (
              <p className="text-sm text-doux">Rattaché à aucun élève.</p>
            ) : (
              <ul className="panneau divide-y divide-bordure text-sm">
                {c.students.map((e) => (
                  <li key={e.relationshipId} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                    <Link href={`/eleves/${e.id}`} className="lien font-medium">
                      {e.name}
                    </Link>
                    <span className="text-doux">{roles(e)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {season && <BilledEnrollments enrollments={billed} season={season.label} />}
          <PaymentsSection
            payerId={c.id}
            balance={balance}
            payments={payments}
            back={`/contacts/${c.id}`}
            isDirector={role === "director"}
            today={today}
          />
        </div>
      </div>
    </article>
  );
}
