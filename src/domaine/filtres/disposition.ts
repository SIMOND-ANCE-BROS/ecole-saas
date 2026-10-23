import type { DefColonne } from "./filtres";

/**
 * Disposition des colonnes d'une liste (#89) : ordre et visibilité, choisis
 * par chaque membre. Enregistrée comme la liste de toutes les colonnes dans
 * l'ordre, les masquées préfixées par « - » : une colonne ajoutée plus tard
 * au logiciel garde ainsi sa visibilité par défaut au lieu de passer pour
 * masquée. Une largeur choisie s'écrit après « @ », en pixels (#102) :
 * `nom@180`, `-age@90`.
 */

export type Disposition = { id: string; visible: boolean; largeur?: number | null }[];

/** Bornes d'une largeur de colonne choisie à la souris. */
export const LARGEUR_MIN = 60;
export const LARGEUR_MAX = 1200;
const borner = (l: number) => Math.round(Math.min(LARGEUR_MAX, Math.max(LARGEUR_MIN, l)));

const visibleParDefaut = (c: DefColonne) => c.parDefaut !== false;

/** Disposition par défaut : ordre des définitions, colonnes `parDefaut: false` masquées. */
export const dispositionParDefaut = (colonnes: DefColonne[]): Disposition =>
  colonnes.map((c) => ({ id: c.id, visible: visibleParDefaut(c) }));

/**
 * Disposition d'un membre : identifiants inconnus et doublons ignorés,
 * colonnes absentes ajoutées à la fin avec leur visibilité par défaut. Au
 * moins une colonne reste visible, et toujours une colonne obligatoire (le nom).
 */
export function lireDisposition(colonnes: DefColonne[], enregistree: string[] | null | undefined): Disposition {
  if (!enregistree) return dispositionParDefaut(colonnes);
  const connues = new Set(colonnes.map((c) => c.id));
  const obligatoires = new Set(colonnes.filter((c) => c.obligatoire).map((c) => c.id));
  const vues = new Set<string>();
  const d: Disposition = [];
  for (const brut of enregistree) {
    const masquee = brut.startsWith("-");
    const [id, l] = (masquee ? brut.slice(1) : brut).split("@");
    if (!connues.has(id) || vues.has(id)) continue;
    vues.add(id);
    const largeur = l && /^\d+$/.test(l) ? borner(Number(l)) : null;
    d.push({ id, visible: !masquee || obligatoires.has(id), ...(largeur ? { largeur } : {}) });
  }
  for (const c of colonnes) if (!vues.has(c.id)) d.push({ id: c.id, visible: visibleParDefaut(c) });
  if (!d.some((c) => c.visible) && d.length > 0) d[0] = { ...d[0], visible: true };
  return d;
}

export const ecrireDisposition = (d: Disposition): string[] =>
  d.map((c) => `${c.visible ? "" : "-"}${c.id}${c.largeur ? `@${c.largeur}` : ""}`);

/** Place la colonne `id` juste avant `avant` (glisser-déposer d'un en-tête) ; `avant` null : à la fin. */
export function placer(d: Disposition, id: string, avant: string | null): Disposition {
  const c = d.find((x) => x.id === id);
  if (!c || id === avant) return d;
  const reste = d.filter((x) => x.id !== id);
  const i = avant === null ? reste.length : reste.findIndex((x) => x.id === avant);
  if (i === -1) return d;
  return [...reste.slice(0, i), c, ...reste.slice(i)];
}

/** Largeur choisie d'une colonne, bornée ; null : largeur automatique. */
export function redimensionner(d: Disposition, id: string, largeur: number | null): Disposition {
  return d.map((c) => (c.id === id ? { ...c, largeur: largeur === null ? null : borner(largeur) } : c));
}

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
