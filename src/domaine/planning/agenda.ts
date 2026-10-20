/**
 * Mise en page du planning en vue agenda : axe horaire commun, cours placés à
 * leur heure, cours simultanés côte à côte. Fonctions pures, en minutes
 * depuis minuit (heure de Paris des cours).
 */

export type CoursAgenda = { id: string; jourSemaine: number | null; heureDebut: string; dureeMinutes: number };

export const versMinutes = (heure: string) => Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5));
export const versHeure = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Arrondi au pas le plus proche (quart d'heure par défaut). */
export const aimanter = (minutes: number, pas = 15) => Math.round(minutes / pas) * pas;

/** Plage horaire affichée : de l'heure pleine avant le premier cours à celle après le dernier ; 9 h–21 h sans cours. */
export function bornesJournee(cours: CoursAgenda[]): { debut: number; fin: number } {
  const hebdo = cours.filter((c) => c.jourSemaine !== null);
  if (hebdo.length === 0) return { debut: 9 * 60, fin: 21 * 60 };
  const debut = Math.min(9 * 60, ...hebdo.map((c) => versMinutes(c.heureDebut)));
  const fin = Math.max(21 * 60, ...hebdo.map((c) => versMinutes(c.heureDebut) + c.dureeMinutes));
  return { debut: Math.floor(debut / 60) * 60, fin: Math.ceil(fin / 60) * 60 };
}

/**
 * Colonne de chaque cours dans sa journée : les cours qui se chevauchent
 * forment un groupe partagé en autant de colonnes que nécessaire ; un cours
 * prend la première colonne libre à son heure.
 */
export function disposer(cours: CoursAgenda[]): Map<string, { colonne: number; colonnes: number }> {
  const resultat = new Map<string, { colonne: number; colonnes: number }>();
  const parJour = new Map<number, CoursAgenda[]>();
  for (const c of cours) if (c.jourSemaine !== null) parJour.set(c.jourSemaine, [...(parJour.get(c.jourSemaine) ?? []), c]);

  for (const duJour of parJour.values()) {
    const tries = [...duJour].sort((a, b) => versMinutes(a.heureDebut) - versMinutes(b.heureDebut) || b.dureeMinutes - a.dureeMinutes);
    let groupe: { id: string; colonne: number }[] = [];
    let finsColonnes: number[] = [];
    let finGroupe = -1;
    const fermer = () => {
      for (const g of groupe) resultat.set(g.id, { colonne: g.colonne, colonnes: finsColonnes.length });
      groupe = [];
      finsColonnes = [];
    };
    for (const c of tries) {
      const debut = versMinutes(c.heureDebut);
      const fin = debut + c.dureeMinutes;
      if (debut >= finGroupe) fermer();
      let colonne = finsColonnes.findIndex((f) => f <= debut);
      if (colonne === -1) colonne = finsColonnes.push(fin) - 1;
      else finsColonnes[colonne] = fin;
      groupe.push({ id: c.id, colonne });
      finGroupe = Math.max(finGroupe, fin);
    }
    fermer();
  }
  return resultat;
}
