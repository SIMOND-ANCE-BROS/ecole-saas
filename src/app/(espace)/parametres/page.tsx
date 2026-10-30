import type { Metadata } from "next";
import { Paper, Text, Title } from "@mantine/core";
import Link from "next/link";
import { withSchool } from "@/db";
import { listDisciplines, listPlaces, listSeasons } from "@/db/settings";
import { listEntities } from "@/db/billing-entities";
import { readMethodSettings } from "@/db/payment-methods";
import { offeredMethods } from "@/domain/payments/methods";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Paramètres" };

/** Whatever is specific to the school is entered here: never in the code. */
export default async function SettingsPage() {
  const { schoolId: schoolId } = await requireRole("director");
  const {
    seasons: seasons,
    disciplines,
    seats: seats,
    entities,
    methods,
  } = await withSchool(schoolId, async (tx) => ({
    seasons: await listSeasons(tx),
    disciplines: await listDisciplines(tx),
    seats: await listPlaces(tx),
    entities: await listEntities(tx),
    methods: await readMethodSettings(tx),
  }));
  const accepted = offeredMethods(methods).length;
  const rooms = seats.reduce((n, s) => n + s.rooms.length, 0);
  const sections = [
    {
      href: "/parametres/saisons",
      title: "Saisons",
      detail: `${seasons.length} saison${seasons.length > 1 ? "s" : ""}, dates et reprise de la grille`,
    },
    {
      href: "/parametres/tarifs",
      title: "Tarifs et réductions",
      detail: "Grille des forfaits, réduction fratrie, carnets de cours particuliers",
    },
    {
      href: "/parametres/disciplines",
      title: "Disciplines",
      detail: `${disciplines.length} discipline${disciplines.length > 1 ? "s" : ""} proposée${disciplines.length > 1 ? "s" : ""}`,
    },
    {
      href: "/parametres/lieux",
      title: "Sites et salles",
      detail: `${seats.length} site${seats.length > 1 ? "s" : ""}, ${rooms} salle${rooms > 1 ? "s" : ""}`,
    },
    {
      href: "/parametres/documents",
      title: "Documents demandés",
      detail: "Certificat médical, validité et délai pour le fournir",
    },
    { href: "/planning/fermetures", title: "Fermetures", detail: "Vacances, jours fériés, gala" },
    {
      href: "/parametres/entreprises",
      title: "Entreprises",
      detail: `${entities.length} entreprise${entities.length > 1 ? "s" : ""} : SIREN, TVA et compte bancaire`,
    },
    {
      href: "/parametres/moyens-de-paiement",
      title: "Moyens de paiement",
      detail: `${accepted} moyen${accepted > 1 ? "s" : ""} accepté${accepted > 1 ? "s" : ""}, consignes pour l’accueil`,
    },
    { href: "/parametres/tva", title: "TVA", detail: "Exonération ou taux de TVA des cours et des carnets" },
    { href: "/intervenants", title: "Intervenants", detail: "Professeurs, statut et rémunération" },
    { href: "/parametres/equipe", title: "Équipe", detail: "Accès de la direction et de l’accueil, invitations" },
  ];
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div>
        <Title order={1} fz="xl">
          Paramètres
        </Title>
        <Text size="sm" c="dimmed">
          Tout ce qui est propre à l’école : ses saisons, ses disciplines, ses lieux, ses tarifs et ses entreprises.
        </Text>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="block h-full rounded-md">
              <Paper withBorder p="md" className="flex h-full flex-col gap-1 hover:border-accent">
                <span className="font-semibold">{r.title}</span>
                <Text span size="sm" c="dimmed">
                  {r.detail}
                </Text>
              </Paper>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
