import { bornesJournee, type CoursAgenda, versMinutes } from "./agenda";
import { NOMS_JOURS } from "./jours";

/**
 * Jours et heures d'ouverture des sites (#90). Un site sans horaire saisi
 * n'impose rien : l'agenda garde alors sa semaine du lundi au samedi et sa
 * plage calculée d'après les cours.
 */

/** Ouverture d'un jour : heures `HH:MM`, jour 1 = lundi … 7 = dimanche. */
export type Horaire = { jourSemaine: number; ouverture: string; fermeture: string };

/** Plages ouvertes d'un jour (en minutes), fusionnées quand plusieurs sites se chevauchent. */
export function plagesOuvertes(horaires: Horaire[], jour: number): { debut: number; fin: number }[] {
  const plages = horaires
    .filter((h) => h.jourSemaine === jour)
    .map((h) => ({ debut: versMinutes(h.ouverture), fin: versMinutes(h.fermeture) }))
    .sort((a, b) => a.debut - b.debut);
  const r: { debut: number; fin: number }[] = [];
  for (const p of plages) {
    const derniere = r.at(-1);
    if (derniere && p.debut <= derniere.fin) derniere.fin = Math.max(derniere.fin, p.fin);
    else r.push({ ...p });
  }
  return r;
}

/**
 * Cadre de l'agenda pour les horaires des sites affichés : jours ouverts (plus
 * ceux où un cours existe déjà), plage de la plus tôt ouverture à la plus
 * tardive fermeture, élargie aux cours qui en sortent, en heures pleines.
 */
export function cadreAgenda(
  horaires: Horaire[],
  cours: CoursAgenda[],
): { jours: number[]; debut: number; fin: number } {
  const hebdo = cours.filter((c) => c.jourSemaine !== null);
  if (horaires.length === 0) {
    const { debut, fin } = bornesJournee(cours);
    return { jours: [1, 2, 3, 4, 5, 6, ...(hebdo.some((c) => c.jourSemaine === 7) ? [7] : [])], debut, fin };
  }
  const jours = [
    ...new Set([...horaires.map((h) => h.jourSemaine), ...hebdo.map((c) => c.jourSemaine as number)]),
  ].sort((a, b) => a - b);
  const debut = Math.min(
    ...horaires.map((h) => versMinutes(h.ouverture)),
    ...hebdo.map((c) => versMinutes(c.heureDebut)),
  );
  const fin = Math.max(
    ...horaires.map((h) => versMinutes(h.fermeture)),
    ...hebdo.map((c) => versMinutes(c.heureDebut) + c.dureeMinutes),
  );
  return { jours, debut: Math.floor(debut / 60) * 60, fin: Math.ceil(fin / 60) * 60 };
}

/**
 * Message si un créneau hebdomadaire sort des horaires de son site ; null s'il
 * y entre, ou si le site n'a pas d'horaires (rien à vérifier).
 */
export function horsHoraires(
  creneau: { jourSemaine: number; heureDebut: string; dureeMinutes: number },
  horaires: Horaire[],
): string | null {
  if (horaires.length === 0) return null;
  const plages = plagesOuvertes(horaires, creneau.jourSemaine);
  if (plages.length === 0) return `Le site est fermé le ${NOMS_JOURS[creneau.jourSemaine]}.`;
  const debut = versMinutes(creneau.heureDebut);
  const fin = debut + creneau.dureeMinutes;
  if (plages.some((p) => p.debut <= debut && fin <= p.fin)) return null;
  const h = horaires.find((x) => x.jourSemaine === creneau.jourSemaine)!;
  return `En dehors des horaires du site le ${NOMS_JOURS[creneau.jourSemaine]} (${h.ouverture}–${h.fermeture}).`;
}
