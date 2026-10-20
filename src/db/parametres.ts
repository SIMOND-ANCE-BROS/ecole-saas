import { and, asc, desc, eq, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { cours, discipline, saison, salle, site } from "./schema";

/**
 * Paramètres de l'école (#80) : saisons, disciplines, sites et salles. Tout ce
 * qui est propre à une école se saisit ici, jamais dans le code. Toujours avec
 * la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
export type Resultat = { ok: true; id: string } | { ok: false; message: string };
const nomValide = z.string().trim().min(1, "Nom obligatoire").max(100);
const compte = (requete: SQL) => sql<number>`(${requete})::int`;

// ---------------------------------------------------------------------------
// Saisons
// ---------------------------------------------------------------------------

export type LigneSaison = { id: string; libelle: string; dateDebut: string; dateFin: string; cours: number; tarifs: number };

export function listerSaisons(tx: Tx): Promise<LigneSaison[]> {
  const id = sql`${saison}.${sql.identifier("id")}`;
  return tx
    .select({
      id: saison.id,
      libelle: saison.libelle,
      dateDebut: saison.dateDebut,
      dateFin: saison.dateFin,
      cours: compte(sql`SELECT count(*) FROM cours c WHERE c.saison_id = ${id}`),
      tarifs: compte(sql`SELECT count(*) FROM tarif t WHERE t.saison_id = ${id}`),
    })
    .from(saison)
    .orderBy(desc(saison.dateDebut));
}

export const saisieSaisonValide = z
  .object({
    libelle: z.string().trim().min(1, "Libellé obligatoire").max(30),
    dateDebut: z.iso.date("Date invalide"),
    dateFin: z.iso.date("Date invalide"),
  })
  .refine((s) => s.dateFin > s.dateDebut, { path: ["dateFin"], message: "La fin doit suivre le début." });

async function controlerSaison(tx: Tx, s: z.output<typeof saisieSaisonValide>, sauf?: string): Promise<string | null> {
  const autre = sauf ? ne(saison.id, sauf) : undefined;
  const [doublon] = await tx.select({ id: saison.id }).from(saison).where(and(eq(saison.libelle, s.libelle), autre));
  if (doublon) return "Une saison porte déjà ce libellé.";
  const [chevauche] = await tx
    .select({ libelle: saison.libelle })
    .from(saison)
    .where(and(sql`${saison.dateDebut} <= ${s.dateFin}`, sql`${saison.dateFin} >= ${s.dateDebut}`, autre));
  return chevauche ? `Ces dates chevauchent la saison ${chevauche.libelle}.` : null;
}

/**
 * Crée une saison ; avec `reprendreDe`, recopie la grille tarifaire, les
 * réductions et les carnets de cette saison (les prix restent à revoir).
 */
export async function creerSaison(tx: Tx, saisie: z.input<typeof saisieSaisonValide>, reprendreDe: string | null): Promise<Resultat> {
  const s = saisieSaisonValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const refus = await controlerSaison(tx, s.data);
  if (refus) return { ok: false, message: refus };
  if (reprendreDe) {
    const [ref] = estUuid(reprendreDe) ? await tx.select({ id: saison.id }).from(saison).where(eq(saison.id, reprendreDe)) : [];
    if (!ref) return { ok: false, message: "Saison de référence introuvable." };
  }

  const [{ id }] = await tx.insert(saison).values({ ...s.data, ecoleId: ECOLE_COURANTE }).returning({ id: saison.id });
  if (reprendreDe) {
    await tx.execute(sql`
      INSERT INTO tarif (ecole_id, saison_id, public, periodicite, combinaison, discipline_id, prix_centimes)
      SELECT ecole_id, ${id}, public, periodicite, combinaison, discipline_id, prix_centimes FROM tarif WHERE saison_id = ${reprendreDe}`);
    await tx.execute(sql`
      INSERT INTO reduction (ecole_id, saison_id, code, taux_points_base, montant_centimes, non_cumulable_avec, seuil_danseurs, publics, cumulable_multi_disciplines)
      SELECT ecole_id, ${id}, code, taux_points_base, montant_centimes, non_cumulable_avec, seuil_danseurs, publics, cumulable_multi_disciplines
      FROM reduction WHERE saison_id = ${reprendreDe}`);
    await tx.execute(sql`
      INSERT INTO tarif_carnet (ecole_id, saison_id, nb_seances, personnes_max, prix_centimes)
      SELECT ecole_id, ${id}, nb_seances, personnes_max, prix_centimes FROM tarif_carnet WHERE saison_id = ${reprendreDe}`);
  }
  return { ok: true, id };
}

export async function modifierSaison(tx: Tx, id: string, saisie: z.input<typeof saisieSaisonValide>): Promise<Resultat> {
  const s = saisieSaisonValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!estUuid(id)) return { ok: false, message: "Cette saison n’existe plus." };
  const refus = await controlerSaison(tx, s.data, id);
  if (refus) return { ok: false, message: refus };
  const lignes = await tx.update(saison).set(s.data).where(eq(saison.id, id)).returning({ id: saison.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Cette saison n’existe plus." };
}

// ---------------------------------------------------------------------------
// Disciplines
// ---------------------------------------------------------------------------

export type LigneDiscipline = { id: string; nom: string; cours: number; tarifs: number };

export function listerDisciplines(tx: Tx): Promise<LigneDiscipline[]> {
  const id = sql`${discipline}.${sql.identifier("id")}`;
  return tx
    .select({
      id: discipline.id,
      nom: discipline.nom,
      cours: compte(sql`SELECT count(*) FROM cours c WHERE c.discipline_id = ${id}`),
      tarifs: compte(sql`SELECT count(*) FROM tarif t WHERE t.discipline_id = ${id}`),
    })
    .from(discipline)
    .orderBy(asc(discipline.nom));
}

async function nomDisciplinePris(tx: Tx, nom: string, sauf?: string): Promise<boolean> {
  const [x] = await tx
    .select({ id: discipline.id })
    .from(discipline)
    .where(and(sql`lower(${discipline.nom}) = lower(${nom})`, sauf ? ne(discipline.id, sauf) : undefined));
  return Boolean(x);
}

export async function creerDiscipline(tx: Tx, nom: string): Promise<Resultat> {
  const n = nomValide.safeParse(nom);
  if (!n.success) return { ok: false, message: n.error.issues[0].message };
  if (await nomDisciplinePris(tx, n.data)) return { ok: false, message: "Cette discipline existe déjà." };
  const [{ id }] = await tx.insert(discipline).values({ nom: n.data, ecoleId: ECOLE_COURANTE }).returning({ id: discipline.id });
  return { ok: true, id };
}

export async function renommerDiscipline(tx: Tx, id: string, nom: string): Promise<Resultat> {
  const n = nomValide.safeParse(nom);
  if (!n.success) return { ok: false, message: n.error.issues[0].message };
  if (!estUuid(id)) return { ok: false, message: "Cette discipline n’existe plus." };
  if (await nomDisciplinePris(tx, n.data, id)) return { ok: false, message: "Cette discipline existe déjà." };
  const lignes = await tx.update(discipline).set({ nom: n.data }).where(eq(discipline.id, id)).returning({ id: discipline.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Cette discipline n’existe plus." };
}

/** Refusé tant qu'un cours ou un tarif l'utilise. */
export async function supprimerDiscipline(tx: Tx, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Cette discipline n’existe plus." };
  const d = (await listerDisciplines(tx)).find((x) => x.id === id);
  if (!d) return { ok: false, message: "Cette discipline n’existe plus." };
  if (d.cours > 0 || d.tarifs > 0) {
    return { ok: false, message: `${d.nom} est utilisée (${d.cours} cours, ${d.tarifs} tarif${d.tarifs > 1 ? "s" : ""}) : retirez-les d’abord.` };
  }
  await tx.delete(discipline).where(eq(discipline.id, id));
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Sites et salles
// ---------------------------------------------------------------------------

export type LigneSalle = { id: string; nom: string; capacite: number | null; cours: number };
export type LigneSite = { id: string; nom: string; adresse: string; permanence: boolean; salles: LigneSalle[] };

export async function listerLieux(tx: Tx): Promise<LigneSite[]> {
  const sites = await tx
    .select({ id: site.id, nom: site.nom, adresse: site.adresse, permanence: site.permanence })
    .from(site)
    .orderBy(asc(site.nom));
  const idSalle = sql`${salle}.${sql.identifier("id")}`;
  const salles = await tx
    .select({
      id: salle.id,
      siteId: salle.siteId,
      nom: salle.nom,
      capacite: salle.capacite,
      cours: compte(sql`SELECT count(*) FROM cours c WHERE c.salle_id = ${idSalle}`),
    })
    .from(salle)
    .orderBy(asc(salle.nom));
  return sites.map((s) => ({
    ...s,
    salles: salles.filter((x) => x.siteId === s.id).map((x) => ({ id: x.id, nom: x.nom, capacite: x.capacite, cours: x.cours })),
  }));
}

export const saisieSiteValide = z.object({
  nom: nomValide,
  adresse: z.string().trim().min(1, "Adresse obligatoire").max(300),
  permanence: z.boolean(),
});

export async function creerSite(tx: Tx, saisie: z.input<typeof saisieSiteValide>): Promise<Resultat> {
  const s = saisieSiteValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const [{ id }] = await tx.insert(site).values({ ...s.data, ecoleId: ECOLE_COURANTE }).returning({ id: site.id });
  return { ok: true, id };
}

export async function modifierSite(tx: Tx, id: string, saisie: z.input<typeof saisieSiteValide>): Promise<Resultat> {
  const s = saisieSiteValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!estUuid(id)) return { ok: false, message: "Ce site n’existe plus." };
  const lignes = await tx.update(site).set(s.data).where(eq(site.id, id)).returning({ id: site.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Ce site n’existe plus." };
}

/** Refusé tant que le site a des salles. */
export async function supprimerSite(tx: Tx, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Ce site n’existe plus." };
  const [s] = await tx.select({ nom: site.nom }).from(site).where(eq(site.id, id));
  if (!s) return { ok: false, message: "Ce site n’existe plus." };
  const [x] = await tx.select({ id: salle.id }).from(salle).where(eq(salle.siteId, id)).limit(1);
  if (x) return { ok: false, message: `${s.nom} a encore des salles : retirez-les d’abord.` };
  await tx.delete(site).where(eq(site.id, id));
  return { ok: true, id };
}

export const saisieSalleValide = z.object({
  siteId: z.uuid(),
  nom: nomValide,
  capacite: z.int().min(1).max(1000).nullable(),
});

export async function creerSalle(tx: Tx, saisie: z.input<typeof saisieSalleValide>): Promise<Resultat> {
  const s = saisieSalleValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.data.siteId));
  if (!x) return { ok: false, message: "Site introuvable." };
  const [{ id }] = await tx.insert(salle).values({ ...s.data, ecoleId: ECOLE_COURANTE }).returning({ id: salle.id });
  return { ok: true, id };
}

export async function modifierSalle(tx: Tx, id: string, saisie: z.input<typeof saisieSalleValide>): Promise<Resultat> {
  const s = saisieSalleValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!estUuid(id)) return { ok: false, message: "Cette salle n’existe plus." };
  const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.data.siteId));
  if (!x) return { ok: false, message: "Site introuvable." };
  const lignes = await tx.update(salle).set(s.data).where(eq(salle.id, id)).returning({ id: salle.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Cette salle n’existe plus." };
}

/** Refusé tant qu'un cours (de n'importe quelle saison) a lieu dans la salle. */
export async function supprimerSalle(tx: Tx, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Cette salle n’existe plus." };
  const [s] = await tx.select({ nom: salle.nom }).from(salle).where(eq(salle.id, id));
  if (!s) return { ok: false, message: "Cette salle n’existe plus." };
  const [c] = await tx.select({ id: cours.id }).from(cours).where(eq(cours.salleId, id)).limit(1);
  if (c) return { ok: false, message: `Des cours ont lieu dans ${s.nom} : déplacez-les d’abord.` };
  await tx.delete(salle).where(eq(salle.id, id));
  return { ok: true, id };
}
