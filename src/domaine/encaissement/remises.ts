/**
 * Remises en banque et journal des encaissements (#98) : règles pures, en
 * centimes, dates `YYYY-MM-DD`.
 */

export const MOYENS_REMISE = ["cheque", "especes", "cheque_vacances"] as const;
export type MoyenRemise = (typeof MOYENS_REMISE)[number];
export const estRemisable = (moyen: string): moyen is MoyenRemise => (MOYENS_REMISE as readonly string[]).includes(moyen);

export type PaiementRemisable = {
  id: string;
  moyen: string;
  montantCentimes: number;
  /** Montant déjà annulé par des corrections. */
  corrigeCentimes: number;
  encaissementPrevu: string | null;
  remiseId: string | null;
};

/**
 * Paiements à remettre, par moyen : chèques (une fois leur date
 * d'encaissement arrivée), espèces et chèques vacances, pas encore remis ni
 * entièrement annulés par une correction.
 */
export function aRemettre<T extends PaiementRemisable>(paiements: T[], aujourdhui: string): Record<MoyenRemise, T[]> {
  const r: Record<MoyenRemise, T[]> = { cheque: [], especes: [], cheque_vacances: [] };
  for (const p of paiements) {
    if (!estRemisable(p.moyen) || p.montantCentimes <= 0 || p.remiseId !== null) continue;
    if (p.montantCentimes - p.corrigeCentimes <= 0) continue;
    if (p.encaissementPrevu !== null && p.encaissementPrevu > aujourdhui) continue;
    r[p.moyen].push(p);
  }
  return r;
}

/** Total général et par moyen. */
export function totaux<T extends { moyen: string; montantCentimes: number }>(lignes: T[]): { total: number; parMoyen: Record<string, number> } {
  const parMoyen: Record<string, number> = {};
  let total = 0;
  for (const l of lignes) {
    parMoyen[l.moyen] = (parMoyen[l.moyen] ?? 0) + l.montantCentimes;
    total += l.montantCentimes;
  }
  return { total, parMoyen };
}

export type LigneExport = {
  date: string;
  payeur: string;
  moyen: string;
  montantCentimes: number;
  reference: string | null;
  emetteur: string | null;
  encaissementPrevu: string | null;
  remise: string | null;
};

const montant = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, "0")}`;
const dateFr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
/** Cellule texte : guillemets si besoin, et jamais interprétée comme formule par un tableur. */
function texte(v: string | null): string {
  let t = v ?? "";
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Export CSV pour la comptabilité : séparateur « ; », montants « 123,45 », dates JJ/MM/AAAA, BOM pour Excel. */
export function versCsv(lignes: LigneExport[]): string {
  const entete = ["Date", "Payeur", "Moyen", "Montant", "Référence", "Émetteur", "Encaissement prévu", "Remise"];
  const corps = lignes.map((l) =>
    [dateFr(l.date), texte(l.payeur), texte(l.moyen), montant(l.montantCentimes), texte(l.reference), texte(l.emetteur), dateFr(l.encaissementPrevu), dateFr(l.remise)].join(";"),
  );
  return `﻿${[entete.join(";"), ...corps].join("\r\n")}\r\n`;
}
