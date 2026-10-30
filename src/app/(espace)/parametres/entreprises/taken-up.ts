/**
 * The banner of « Factures à reprendre » once management took an invoice up (#352), keyed by the
 * URL parameter `?reprise=` (French: user-visible, data).
 */
export const TAKEN_UP = {
  renvoyee: "Facture renvoyée à l’outil de facturation : elle part d’elle-même, rien d’autre à faire.",
  refaite:
    "Facture préparée de nouveau à partir de ses lignes : elle part d’elle-même, ou attend ses échéances (voir la fiche du payeur).",
  retiree: "Facture retirée de la liste : ses lignes sont déjà sur une autre facture.",
  abandonnee: "Facture abandonnée : ses lignes reviendront dans la prochaine facture préparée pour ce payeur.",
} as const;

export type TakenUp = keyof typeof TAKEN_UP;
