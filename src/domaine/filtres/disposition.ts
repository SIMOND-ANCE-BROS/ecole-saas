import type { DefColonne } from "./filtres";

/**
 * Disposition des colonnes d'une liste (#89) : ordre et visibilité, choisis
 * par chaque membre. Enregistrée comme la liste de toutes les colonnes dans
 * l'ordre, les masquées préfixées par « - » : une colonne ajoutée plus tard
 * au logiciel garde ainsi sa visibilité par défaut au lieu de passer pour
 * masquée.
 */

export type Disposition = { id: string; visible: boolean }[];

const visibleParDefaut = (c: DefColonne) => c.parDefaut !== false;

/** Disposition par défaut : ordre des définitions, colonnes `parDefaut: false` masquées. */
export const dispositionParDefaut = (colonnes: DefColonne[]): Disposition => colonnes.map((c) => ({ id: c.id, visible: visibleParDefaut(c) }));

/**
 * Disposition d'un membre : identifiants inconnus et doublons ignorés,
 * colonnes absentes ajoutées à la fin avec leur visibilité par défaut. Au
 * moins une colonne reste visible.
 */
export function lireDisposition(colonnes: DefColonne[], enregistree: string[] | null | undefined): Disposition {
  if (!enregistree) return dispositionParDefaut(colonnes);
  const connues = new Set(colonnes.map((c) => c.id));
  const vues = new Set<string>();
  const d: Disposition = [];
  for (const brut of enregistree) {
    const masquee = brut.startsWith("-");
    const id = masquee ? brut.slice(1) : brut;
    if (!connues.has(id) || vues.has(id)) continue;
    vues.add(id);
    d.push({ id, visible: !masquee });
  }
  for (const c of colonnes) if (!vues.has(c.id)) d.push({ id: c.id, visible: visibleParDefaut(c) });
  if (!d.some((c) => c.visible) && d.length > 0) d[0] = { ...d[0], visible: true };
  return d;
}

export const ecrireDisposition = (d: Disposition): string[] => d.map((c) => (c.visible ? c.id : `-${c.id}`));

/** Déplace une colonne d'un cran (-1 : vers la gauche, +1 : vers la droite). */
export function deplacer(d: Disposition, id: string, sens: -1 | 1): Disposition {
  const i = d.findIndex((c) => c.id === id);
  const j = i + sens;
  if (i === -1 || j < 0 || j >= d.length) return d;
  const r = [...d];
  [r[i], r[j]] = [r[j], r[i]];
  return r;
}

/** Affiche ou masque une colonne ; la dernière colonne visible ne peut pas être masquée. */
export function basculer(d: Disposition, id: string): Disposition {
  const cible = d.find((c) => c.id === id);
  if (!cible || (cible.visible && d.filter((c) => c.visible).length === 1)) return d;
  return d.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
}
