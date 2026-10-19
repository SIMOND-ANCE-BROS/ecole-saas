import type { LienFiche, TypeLien } from "@/db/personnes";

/**
 * Relations proposées depuis la fiche d'une personne P vers une autre Q, et le
 * lien orienté qu'elles donnent : `de: "autre"` signifie « Q est <type> de P ».
 */
export const RELATIONS = {
  representant: { libelle: "son représentant légal (parent, tuteur)", type: "representant_legal", de: "autre" },
  represente: { libelle: "son enfant, ou une personne qu’il représente", type: "representant_legal", de: "fiche" },
  conjoint: { libelle: "son conjoint", type: "conjoint", de: "fiche" },
  autre: { libelle: "un autre proche, son employeur, un CSE…", type: "autre", de: "autre" },
} as const satisfies Record<string, { libelle: string; type: TypeLien; de: "autre" | "fiche" }>;

export type Relation = keyof typeof RELATIONS;
export const estRelation = (v: unknown): v is Relation => typeof v === "string" && v in RELATIONS;

/** Nature de l'autre personne, vue depuis la fiche. */
export function natureDuLien(l: Pick<LienFiche, "type" | "sens">): string {
  if (l.type === "conjoint") return "Conjoint";
  if (l.type === "representant_legal") return l.sens === "vers" ? "Représentant légal" : "Représenté (enfant)";
  return "Proche";
}
