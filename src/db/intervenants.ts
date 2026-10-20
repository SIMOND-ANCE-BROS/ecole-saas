import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { supprimerConnexion } from "./connexions-agenda";
import type { Tx } from "./index";
import { intervenant } from "./schema";

/** Intervenants (professeurs), toujours avec la transaction d'`avecEcole()` (RLS). */

export const STATUTS = { micro_entreprise: "Micro-entreprise", societe: "Société", salarie: "Salarié" } as const;
export const REGIMES_TVA = {
  franchise_293b: "Franchise en base (293 B)",
  assujetti: "Assujetti à la TVA",
  non_applicable: "Non applicable",
} as const;
export const MODES_REMUNERATION = { heure: "à l’heure", cours: "au cours", forfait_mensuel: "forfait mensuel" } as const;
/** Unité du tarif selon le mode de rémunération. */
export const UNITES_REMUNERATION = { heure: "heure", cours: "cours", forfait_mensuel: "mois" } as const;

const cles = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const saisieIntervenantValide = z.object({
  prenom: z.string().trim().min(1, "Prénom obligatoire").max(100),
  nom: z.string().trim().min(1, "Nom obligatoire").max(100),
  email: z.union([z.literal(""), z.email("E-mail invalide")]).transform((v) => v || null),
  statut: z.enum(cles(STATUTS)),
  siren: z
    .string()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => v === "" || /^\d{9}$/.test(v), "Le SIREN compte 9 chiffres")
    .transform((v) => v || null),
  regimeTva: z.enum(cles(REGIMES_TVA)),
  estDirigeant: z.boolean(),
  modeRemuneration: z.enum(cles(MODES_REMUNERATION)),
  tarifCentimes: z.int().min(0).max(100_000_00),
  actif: z.boolean(),
});

export type SaisieIntervenant = z.output<typeof saisieIntervenantValide>;
export type Intervenant = SaisieIntervenant & { id: string };

const colonnes = {
  id: intervenant.id,
  prenom: intervenant.prenom,
  nom: intervenant.nom,
  email: intervenant.email,
  statut: intervenant.statut,
  siren: intervenant.siren,
  regimeTva: intervenant.regimeTva,
  estDirigeant: intervenant.estDirigeant,
  modeRemuneration: intervenant.modeRemuneration,
  tarifCentimes: intervenant.tarifCentimes,
  actif: intervenant.actif,
};

/** Cours d'une saison donnés par l'intervenant (titulaire du cours). */
const coursSaison = (saisonId: string) => sql<number>`(
  SELECT count(*)::int FROM cours c
  WHERE c.intervenant_id = ${intervenant}.${sql.identifier("id")} AND c.saison_id = ${saisonId}
)`;

/** Actifs d'abord, puis par nom et prénom. */
export function listerIntervenants(tx: Tx, saisonId: string): Promise<(Intervenant & { coursSaison: number })[]> {
  return tx
    .select({ ...colonnes, coursSaison: coursSaison(saisonId) })
    .from(intervenant)
    .orderBy(desc(intervenant.actif), asc(intervenant.nom), asc(intervenant.prenom));
}

export async function lireIntervenant(tx: Tx, id: string): Promise<Intervenant | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [i] = await tx.select(colonnes).from(intervenant).where(eq(intervenant.id, id));
  return i ?? null;
}

export async function creerIntervenant(tx: Tx, saisie: SaisieIntervenant): Promise<string> {
  const [{ id }] = await tx
    .insert(intervenant)
    .values({ ...saisie, ecoleId: sql`nullif(current_setting('app.ecole_id', true), '')::uuid` })
    .returning({ id: intervenant.id });
  return id;
}

/** false si l'intervenant n'existe pas dans l'école courante. */
export async function modifierIntervenant(tx: Tx, id: string, saisie: SaisieIntervenant): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  // Désactiver un intervenant coupe aussi son abonnement et son agenda connecté.
  const coupure = saisie.actif ? {} : { jetonAgendaHash: null, jetonAgendaCreeLe: null };
  const lignes = await tx
    .update(intervenant)
    .set({ ...saisie, ...coupure })
    .where(eq(intervenant.id, id))
    .returning({ id: intervenant.id });
  if (lignes.length === 1 && !saisie.actif) await supprimerConnexion(tx, id);
  return lignes.length === 1;
}
