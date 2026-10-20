import type { CoursPlanning } from "@/db/planning";

export type FiltresPlanning = { discipline: string; site: string; salleId: string; intervenantId: string };
export const FILTRES_VIDES: FiltresPlanning = { discipline: "", site: "", salleId: "", intervenantId: "" };

/** Les identifiants distinguent les salles homonymes de deux sites. */
export function filtrerPlanning(cours: CoursPlanning[], filtres: FiltresPlanning): CoursPlanning[] {
  return cours.filter((c) =>
    (!filtres.discipline || c.discipline === filtres.discipline) &&
    (!filtres.site || c.site === filtres.site) &&
    (!filtres.salleId || c.salleId === filtres.salleId) &&
    (!filtres.intervenantId || c.intervenantId === filtres.intervenantId),
  );
}
