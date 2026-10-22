/**
 * Solde d'un payeur (#97), en centimes. Tant que les factures n'existent pas,
 * le dû se calcule sur les inscriptions et les carnets du payeur, et les
 * paiements s'enregistrent sur le payeur.
 */

export type StatutInscription = "essai" | "liste_attente" | "active" | "abandon" | "terminee";

/** Statuts comptés dans le dû. Abandon et essai : règle à fixer par l'école (#99), montrés à part. */
export const STATUTS_DUS: StatutInscription[] = ["active", "terminee"];

export type InscriptionDue = { statut: StatutInscription; prixNetCentimes: number };
export type PaiementSolde = { montantCentimes: number; encaissementPrevu: string | null };

export type Solde = {
  du: number;
  paye: number;
  /** Positif : reste à payer ; négatif : trop-perçu. */
  reste: number;
  /** Chèques reçus mais à encaisser après aujourd'hui (comptés dans « payé »). */
  aEncaisser: number;
  /** Inscriptions hors du calcul, par statut (montants), pour que la direction les voie. */
  horsCalcul: Partial<Record<StatutInscription, number>>;
};

export function soldePayeur(
  inscriptions: InscriptionDue[],
  carnets: { prixCentimes: number }[],
  paiements: PaiementSolde[],
  aujourdhui: string,
): Solde {
  let du = carnets.reduce((s, c) => s + c.prixCentimes, 0);
  const horsCalcul: Solde["horsCalcul"] = {};
  for (const i of inscriptions) {
    if (STATUTS_DUS.includes(i.statut)) du += i.prixNetCentimes;
    else horsCalcul[i.statut] = (horsCalcul[i.statut] ?? 0) + i.prixNetCentimes;
  }
  const paye = paiements.reduce((s, p) => s + p.montantCentimes, 0);
  const aEncaisser = paiements
    .filter((p) => p.montantCentimes > 0 && p.encaissementPrevu !== null && p.encaissementPrevu > aujourdhui)
    .reduce((s, p) => s + p.montantCentimes, 0);
  return { du, paye, reste: du - paye, aEncaisser, horsCalcul };
}
