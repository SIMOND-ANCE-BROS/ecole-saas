import type { Metadata } from "next";
import Link from "next/link";
import { withSchool } from "@/db";
import { currentSeason } from "@/db/schedule";
import { listClosures } from "@/db/lessons";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { ClosuresManagement } from "./closures";

export const metadata: Metadata = { title: "Fermetures" };

export default async function ClosuresPage() {
  const { schoolId: schoolId } = await requireRole("director");
  const { season: season, closures: closures } = await withSchool(schoolId, async (tx) => {
    const s = await currentSeason(tx, todayInParis());
    return { season: s, closures: s ? await listClosures(tx, s.id) : [] };
  });

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/planning" className="lien">
          Planning
        </Link>
        <span className="text-doux"> / Fermetures</span>
      </nav>
      <div>
        <h1 className="titre-page">Fermetures {season?.label}</h1>
        <p className="text-sm text-doux">
          Vacances, jours fériés, gala : aucun cours n’a lieu ces jours-là. Les séances à venir se mettent à jour
          aussitôt ; une séance dont l’appel est fait n’est jamais retirée.
        </p>
      </div>
      {season ? (
        <ClosuresManagement closures={closures} seasonStart={season.startDate} seasonEnd={season.endDate} />
      ) : (
        <p className="text-sm">Aucune saison n’est paramétrée.</p>
      )}
    </section>
  );
}
