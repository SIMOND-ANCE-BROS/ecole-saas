import type { Metadata } from "next";
import { Anchor, Paper, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { readContact } from "@/db/students";
import { seasonEnrollments } from "@/db/enrollments";
import { paymentsOf, balanceOf } from "@/db/payments";
import { packsOf } from "@/db/lesson-packs";
import { displayedName } from "@/db/people";
import { currentSeason } from "@/db/schedule";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { Banner, Enrollments, Telephone } from "../../_people/sections";
import { PaymentsSection } from "../../_people/payments-section";
import { mayRefund } from "@/domain/payments/refund";
import { mayCancelRefund } from "@/domain/payments/refund-cancellation";
import { LessonPacks } from "../../_people/lesson-packs";
import { BecomeStudent } from "./become-student";
import { ButtonLink } from "../../_ui/button-link";
import { BackToList } from "../../_ui/list-return";
import { TextLink } from "../../_ui/text-link";

export const metadata: Metadata = { title: "Fiche contact" };

const BANNERS: Record<string, string> = {
  cree: "Contact créé.",
  modifie: "Fiche enregistrée.",
  vendu: "Carnet vendu.",
};

/** Banner after a payment (`?encaisse=3`). */
const collected = (n: unknown) => {
  const k = Number(n);
  return Number.isInteger(k) && k > 0 ? `${k} règlement${k > 1 ? "s" : ""} encaissé${k > 1 ? "s" : ""}.` : undefined;
};

export default async function PageContact({ params, searchParams }: PageProps<"/contacts/[id]">) {
  const { schoolId: schoolId, role } = await requireRole("director", "front_desk");
  const [{ id }, { enregistre, encaisse, carnet }] = await Promise.all([params, searchParams]);
  const today = todayInParis();
  const parsed = await withSchool(schoolId, async (tx) => {
    const contact = await readContact(tx, id);
    if (!contact) return null;
    const season = await currentSeason(tx, today);
    return {
      contact,
      season: season,
      billed: season ? await seasonEnrollments(tx, { payerId: contact.id }, season.id) : [],
      balance: await balanceOf(tx, contact.id, today),
      payments: await paymentsOf(tx, contact.id),
      packs: await packsOf(tx, { personId: contact.id }),
    };
  });
  if (!parsed) notFound();
  const { contact: c, season: season, billed, balance: balance, payments: payments, packs } = parsed;
  // A pack is sold to someone who pays for a student (or is one).
  const sells = c.isStudent || c.students.some((s) => s.paysFor);
  const name = displayedName(c);
  const firstName = c.firstName ?? name;
  const roles = (e: (typeof c.students)[number]) =>
    [e.guardian && "responsable", e.paysFor && "facturé", e.toNotify && "à prévenir"].filter(Boolean).join(", ") ||
    "proche";

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/contacts" size="sm">
          Contacts
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" "}
          / {name}
        </Text>
      </nav>
      <Banner text={collected(encaisse) ?? BANNERS[String(carnet ?? enregistre)]} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Title order={1} fz="xl">
            {name}
          </Title>
          <Text size="sm" c="dimmed">
            {c.type === "organisation" ? `Organisme${c.siren ? `, SIREN ${c.siren}` : ""}` : "Particulier"}
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/contacts/${c.id}/modifier`} variant="default">
            Modifier
          </ButtonLink>
          {c.type === "individual" &&
            (c.isStudent ? (
              <ButtonLink href={`/eleves/${c.id}`} variant="default">
                Voir sa fiche élève
              </ButtonLink>
            ) : (
              <BecomeStudent id={c.id} firstName={firstName} />
            ))}
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <aside aria-label="Coordonnées" className="order-first lg:order-last">
          <Paper
            withBorder
            p="md"
            component="section"
            aria-labelledby="coordonnees"
            className="flex flex-col gap-1 text-sm"
          >
            <Title order={2} size="h6" id="coordonnees">
              Coordonnées
            </Title>
            {c.telephone ? (
              <Telephone number={c.telephone} />
            ) : (
              <Text span size="sm" c="dimmed">
                Pas de téléphone
              </Text>
            )}
            {c.email ? (
              <Anchor href={`mailto:${c.email}`} size="sm" className="break-all">
                {c.email}
              </Anchor>
            ) : (
              <Text span size="sm" c="dimmed">
                Pas d’e-mail
              </Text>
            )}
            {c.address && <span>{c.address}</span>}
          </Paper>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="eleves" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Title order={2} size="h5" id="eleves">
                Élèves
              </Title>
              {c.type === "individual" && (
                <TextLink href={`/eleves/nouveau?responsable=${c.id}`} size="sm">
                  Ajouter un enfant
                </TextLink>
              )}
            </div>
            {c.students.length === 0 ? (
              <Text size="sm" c="dimmed">
                Rattaché à aucun élève.
              </Text>
            ) : (
              <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
                {c.students.map((e) => (
                  <li key={e.relationshipId} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                    <TextLink href={`/eleves/${e.id}`} size="sm" fw={500}>
                      {e.name}
                    </TextLink>
                    <Text span size="sm" c="dimmed">
                      {roles(e)}
                    </Text>
                  </li>
                ))}
              </Paper>
            )}
          </section>
          {season && <Enrollments enrollments={billed} season={season} today={today} payerId={c.id} />}
          {(sells || packs.length > 0) && (
            <LessonPacks packs={packs} personId={c.id} sellHref={sells ? `/carnets/nouveau?payeur=${c.id}` : null} />
          )}
          <PaymentsSection
            payerId={c.id}
            balance={balance}
            payments={payments}
            back={`/contacts/${c.id}`}
            isDirector={role === "director"}
            canRefund={mayRefund(role)}
            canCancelRefund={mayCancelRefund(role)}
            today={today}
          />
        </div>
      </div>
    </article>
  );
}
