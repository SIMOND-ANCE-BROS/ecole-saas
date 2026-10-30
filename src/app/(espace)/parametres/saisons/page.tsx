import type { Metadata } from "next";
import { withSchool } from "@/db";
import { listSeasons } from "@/db/settings";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { Seasons } from "./seasons";

export const metadata: Metadata = { title: "Saisons" };

export default async function SeasonsPage() {
  const { schoolId: schoolId } = await requireRole("director");
  const seasons = await withSchool(schoolId, (tx) => listSeasons(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Saisons"
        help="La saison courante est celle qui contient la date du jour. Une nouvelle saison peut reprendre la grille tarifaire, les réductions et les carnets d’une autre. Ses trimestres, proposés d’office et modifiables, servent aux inscriptions au trimestre."
      />
      <Seasons seasons={seasons} />
    </section>
  );
}
