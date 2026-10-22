import type { Condition, Filtre } from "./filtres";

/**
 * Filtres prêts à l'emploi d'une liste (#107) : des boutons en français
 * (« Inscrits », « Enfants ») au lieu de conditions à composer. Chacun se
 * traduit en conditions ordinaires de l'adresse (`?f=…`), si bien que le
 * serveur filtre exactement comme pour les filtres avancés.
 *
 * Un groupe propose des choix exclusifs (« Inscription » : Inscrits, À l'essai…) ;
 * les groupes se combinent entre eux (ET).
 */
export type ChoixRaccourci = { id: string; libelle: string; conditions: Condition[] };
export type GroupeRaccourcis = { id: string; libelle: string; choix: ChoixRaccourci[] };

const memeCondition = (a: Condition, b: Condition) => a.colonne === b.colonne && a.operateur === b.operateur && a.valeur === b.valeur;
const contient = (filtre: Filtre, c: Condition) => filtre.conditions.some((x) => memeCondition(x, c));

/** Choix actif d'un groupe : toutes ses conditions sont dans le filtre (mode ET). */
export function choixActif(groupe: GroupeRaccourcis, filtre: Filtre): string | null {
  if (filtre.mode !== "et") return null;
  return groupe.choix.find((ch) => ch.conditions.every((c) => contient(filtre, c)))?.id ?? null;
}

/**
 * Filtre avec le choix `choixId` du groupe (null : « Tous ») : les conditions
 * des autres choix du groupe sont retirées, le reste du filtre est gardé et
 * passe en mode ET (un bouton s'ajoute aux autres, jamais « ou »).
 */
export function choisir(filtre: Filtre, groupe: GroupeRaccourcis, choixId: string | null): Filtre {
  const duGroupe = groupe.choix.flatMap((ch) => ch.conditions);
  const autres = filtre.conditions.filter((c) => !duGroupe.some((g) => memeCondition(g, c)));
  const choix = groupe.choix.find((ch) => ch.id === choixId);
  return { mode: "et", conditions: [...autres, ...(choix?.conditions ?? [])] };
}

/** Conditions qui ne viennent d'aucun bouton actif : ce sont des filtres avancés. */
export function conditionsAvancees(filtre: Filtre, groupes: GroupeRaccourcis[]): Condition[] {
  const actives = groupes.flatMap((g) => g.choix.find((ch) => ch.id === choixActif(g, filtre))?.conditions ?? []);
  return filtre.conditions.filter((c) => !actives.some((a) => memeCondition(a, c)));
}
