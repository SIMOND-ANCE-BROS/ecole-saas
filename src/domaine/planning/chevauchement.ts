/** Recouvrement de créneaux hebdomadaires (cours réguliers ; un stage n'a pas de jour). */

export type Creneau = {
  /** 1 = lundi … 7 = dimanche ; null pour un stage. */
  jourSemaine: number | null;
  /** `HH:MM` */
  heureDebut: string;
  dureeMinutes: number;
};

const minutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

export function seChevauchent(a: Creneau, b: Creneau): boolean {
  if (a.jourSemaine === null || a.jourSemaine !== b.jourSemaine) return false;
  const [da, db] = [minutes(a.heureDebut), minutes(b.heureDebut)];
  return da < db + b.dureeMinutes && db < da + a.dureeMinutes;
}

type CoursPlace = Creneau & { id: string | null; salleId: string; intervenantId: string };

/** Cours qui occupent déjà la même salle ou le même intervenant sur le créneau de `cible`. */
export function conflits(cible: CoursPlace, existants: CoursPlace[]) {
  return existants
    .filter((c) => c.id !== cible.id && seChevauchent(cible, c))
    .map((c) => ({ id: c.id as string, salle: c.salleId === cible.salleId, intervenant: c.intervenantId === cible.intervenantId }))
    .filter((c) => c.salle || c.intervenant);
}
