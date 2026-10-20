/**
 * Disponibilité des intervenants : conflits entre séances et indisponibilités,
 * remplaçants libres. Fonctions pures ; les heures de cours sont des heures de
 * Paris, les indisponibilités des instants.
 */

const MINUTE = 60_000;

/** Décalage de Paris par rapport à UTC (en minutes) à un instant donné. */
function decalageParis(instant: number): number {
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  const commeUtc = Date.UTC(+parties.year, +parties.month - 1, +parties.day, +parties.hour, +parties.minute);
  return Math.round((commeUtc - instant) / MINUTE);
}

/** Instant (millisecondes) d'une heure de Paris `HH:MM` un jour `YYYY-MM-DD`. */
export function instantParis(date: string, heure: string): number {
  const [a, m, j] = date.split("-").map(Number);
  const naif = Date.UTC(a, m - 1, j, Number(heure.slice(0, 2)), Number(heure.slice(3, 5)));
  // Deux passes : le décalage peut changer entre l'heure naïve et l'heure réelle.
  const premier = naif - decalageParis(naif) * MINUTE;
  return naif - decalageParis(premier) * MINUTE;
}

export type SeanceDatee = { id: string; date: string; heureDebut: string; dureeMinutes: number; intervenantId: string };
export type Indisponibilite = { intervenantId: string; debut: Date; fin: Date };

export function intervalleSeance(s: Pick<SeanceDatee, "date" | "heureDebut" | "dureeMinutes">): [number, number] {
  const debut = instantParis(s.date, s.heureDebut);
  return [debut, debut + s.dureeMinutes * MINUTE];
}

const chevauche = ([a1, a2]: [number, number], [b1, b2]: [number, number]) => a1 < b2 && b1 < a2;

/** Séances dont l'intervenant est indisponible pendant tout ou partie du créneau. */
export function conflits(seances: SeanceDatee[], indispos: Indisponibilite[]): { seanceId: string; indisponibilite: Indisponibilite }[] {
  return seances.flatMap((s) => {
    const creneau = intervalleSeance(s);
    const i = indispos.find((x) => x.intervenantId === s.intervenantId && chevauche(creneau, [x.debut.getTime(), x.fin.getTime()]));
    return i ? [{ seanceId: s.id, indisponibilite: i }] : [];
  });
}

/**
 * Remplaçants possibles pour une séance, sauf son intervenant : libres d'abord
 * (ni indisponibles, ni pris par une autre séance au même moment), puis ceux
 * qui enseignent déjà la discipline, puis l'ordre donné.
 */
export function remplacantsLibres(
  cible: SeanceDatee & { discipline: string },
  intervenants: { id: string; disciplines: string[] }[],
  autresSeances: SeanceDatee[],
  indispos: Indisponibilite[],
): { id: string; libre: boolean; motif: "indisponible" | "autre séance" | null; enseigne: boolean }[] {
  const creneau = intervalleSeance(cible);
  return intervenants
    .filter((i) => i.id !== cible.intervenantId)
    .map((i, rang) => {
      const indisponible = indispos.some((x) => x.intervenantId === i.id && chevauche(creneau, [x.debut.getTime(), x.fin.getTime()]));
      const occupe = autresSeances.some((s) => s.id !== cible.id && s.intervenantId === i.id && chevauche(creneau, intervalleSeance(s)));
      const motif = indisponible ? ("indisponible" as const) : occupe ? ("autre séance" as const) : null;
      return { id: i.id, libre: motif === null, motif, enseigne: i.disciplines.includes(cible.discipline), rang };
    })
    .sort((a, b) => Number(b.libre) - Number(a.libre) || Number(b.enseigne) - Number(a.enseigne) || a.rang - b.rang)
    .map((r) => ({ id: r.id, libre: r.libre, motif: r.motif, enseigne: r.enseigne }));
}
