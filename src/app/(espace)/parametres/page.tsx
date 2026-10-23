import type { Metadata } from "next";
import Link from "next/link";
import { withSchool } from "@/db";
import { listDisciplines, listPlaces, listSeasons } from "@/db/parametres";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Paramètres" };

/** Ce qui est propre à l'école se saisit ici : jamais dans le code. */
export default async function SettingsPage() {
  const { schoolId: schoolId } = await requireRole("direction");
  const {
    seasons: seasons,
    disciplines,
    seats: seats,
  } = await withSchool(schoolId, async (tx) => ({
    seasons: await listSeasons(tx),
    disciplines: await listDisciplines(tx),
    seats: await listPlaces(tx),
  }));
  const salles = seats.reduce((n, s) => n + s.salles.length, 0);
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
      detail: `${seats.length} site${seats.length > 1 ? "s" : ""}, ${salles} salle${salles > 1 ? "s" : ""}`,
    },
    { href: "/planning/fermetures", title: "Fermetures", detail: "Vacances, jours fériés, gala" },
    { href: "/intervenants", title: "Intervenants", detail: "Professeurs, statut et rémunération" },
  ];
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div>
        <h1 className="titre-page">Paramètres</h1>
        <p className="text-sm text-doux">
          Tout ce qui est propre à l’école : ses saisons, ses disciplines, ses lieux et ses tarifs.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="panneau flex h-full flex-col gap-1 p-4 hover:border-accent">
              <span className="font-semibold">{r.title}</span>
              <span className="text-sm text-doux">{r.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
