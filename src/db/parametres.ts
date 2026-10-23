import { and, asc, desc, eq, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Horaire } from "../domaine/planning/horaires";
import type { Tx } from "./index";
import { course, discipline, siteHours, season, room, site } from "./schema";

/**
 * Paramètres de l'école (#80) : saisons, disciplines, sites et salles. Tout ce
 * qui est propre à une école se saisit ici, jamais dans le code. Toujours avec
 * la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
export type Resultat = { ok: true; id: string } | { ok: false; message: string };
const nomValide = z.string().trim().min(1, "Nom obligatoire").max(100);
const compte = (requete: SQL) => sql<number>`(${requete})::int`;

// ---------------------------------------------------------------------------
// Saisons
// ---------------------------------------------------------------------------

export type LigneSaison = {
  id: string;
  libelle: string;
  dateDebut: string;
  dateFin: string;
  cours: number;
  tarifs: number;
};

export function listerSaisons(tx: Tx): Promise<LigneSaison[]> {
  const id = sql`${season}.${sql.identifier("id")}`;
  return tx
    .select({
      id: season.id,
      libelle: season.label,
      dateDebut: season.startDate,
      dateFin: season.endDate,
      cours: compte(sql`SELECT count(*) FROM course c WHERE c.season_id = ${id}`),
      tarifs: compte(sql`SELECT count(*) FROM tariff t WHERE t.season_id = ${id}`),
    })
    .from(season)
    .orderBy(desc(season.startDate));
}

export const saisieSaisonValide = z
  .object({
    libelle: z.string().trim().min(1, "Libellé obligatoire").max(30),
    dateDebut: z.iso.date("Date invalide"),
    dateFin: z.iso.date("Date invalide"),
  })
  .refine((s) => s.dateFin > s.dateDebut, { path: ["dateFin"], message: "La fin doit suivre le début." });

/** Season columns from the form input. */
const ligneSaison = (s: z.output<typeof saisieSaisonValide>) => ({
  label: s.libelle,
  startDate: s.dateDebut,
  endDate: s.dateFin,
});

async function controlerSaison(tx: Tx, s: z.output<typeof saisieSaisonValide>, sauf?: string): Promise<string | null> {
  const autre = sauf ? ne(season.id, sauf) : undefined;
  const [doublon] = await tx
    .select({ id: season.id })
    .from(season)
    .where(and(eq(season.label, s.libelle), autre));
  if (doublon) return "Une saison porte déjà ce libellé.";
  const [chevauche] = await tx
    .select({ libelle: season.label })
    .from(season)
    .where(and(sql`${season.startDate} <= ${s.dateFin}`, sql`${season.endDate} >= ${s.dateDebut}`, autre));
  return chevauche ? `Ces dates chevauchent la saison ${chevauche.libelle}.` : null;
}

/**
 * Crée une saison ; avec `reprendreDe`, recopie la grille tarifaire, les
 * réductions et les carnets de cette saison (les prix restent à revoir).
 */
export async function creerSaison(
  tx: Tx,
  saisie: z.input<typeof saisieSaisonValide>,
  reprendreDe: string | null,
): Promise<Resultat> {
  const s = saisieSaisonValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const refus = await controlerSaison(tx, s.data);
  if (refus) return { ok: false, message: refus };
  if (reprendreDe) {
    const [ref] = estUuid(reprendreDe)
      ? await tx.select({ id: season.id }).from(season).where(eq(season.id, reprendreDe))
      : [];
    if (!ref) return { ok: false, message: "Saison de référence introuvable." };
  }

  const [{ id }] = await tx
    .insert(season)
    .values({ ...ligneSaison(s.data), schoolId: ECOLE_COURANTE })
    .returning({ id: season.id });
  if (reprendreDe) {
    await tx.execute(sql`
      INSERT INTO tariff (school_id, season_id, audience, period, combination, discipline_id, price_cents)
      SELECT school_id, ${id}, audience, period, combination, discipline_id, price_cents FROM tariff WHERE season_id = ${reprendreDe}`);
    await tx.execute(sql`
      INSERT INTO discount (school_id, season_id, code, rate_bps, amount_cents, not_combinable_with, min_students, audiences, combinable_with_multi_discipline)
      SELECT school_id, ${id}, code, rate_bps, amount_cents, not_combinable_with, min_students, audiences, combinable_with_multi_discipline
      FROM discount WHERE season_id = ${reprendreDe}`);
    await tx.execute(sql`
      INSERT INTO lesson_pack_tariff (school_id, season_id, lesson_count, max_people, price_cents)
      SELECT school_id, ${id}, lesson_count, max_people, price_cents FROM lesson_pack_tariff WHERE season_id = ${reprendreDe}`);
  }
  return { ok: true, id };
}

export async function modifierSaison(
  tx: Tx,
  id: string,
  saisie: z.input<typeof saisieSaisonValide>,
): Promise<Resultat> {
  const s = saisieSaisonValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!estUuid(id)) return { ok: false, message: "Cette saison n’existe plus." };
  const refus = await controlerSaison(tx, s.data, id);
  if (refus) return { ok: false, message: refus };
  const lignes = await tx.update(season).set(ligneSaison(s.data)).where(eq(season.id, id)).returning({ id: season.id });
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
      nom: discipline.name,
      cours: compte(sql`SELECT count(*) FROM course c WHERE c.discipline_id = ${id}`),
      tarifs: compte(sql`SELECT count(*) FROM tariff t WHERE t.discipline_id = ${id}`),
    })
    .from(discipline)
    .orderBy(asc(discipline.name));
}

async function nomDisciplinePris(tx: Tx, nom: string, sauf?: string): Promise<boolean> {
  const [x] = await tx
    .select({ id: discipline.id })
    .from(discipline)
    .where(and(sql`lower(${discipline.name}) = lower(${nom})`, sauf ? ne(discipline.id, sauf) : undefined));
  return Boolean(x);
}

export async function creerDiscipline(tx: Tx, nom: string): Promise<Resultat> {
  const n = nomValide.safeParse(nom);
  if (!n.success) return { ok: false, message: n.error.issues[0].message };
  if (await nomDisciplinePris(tx, n.data)) return { ok: false, message: "Cette discipline existe déjà." };
  const [{ id }] = await tx
    .insert(discipline)
    .values({ name: n.data, schoolId: ECOLE_COURANTE })
    .returning({ id: discipline.id });
  return { ok: true, id };
}

export async function renommerDiscipline(tx: Tx, id: string, nom: string): Promise<Resultat> {
  const n = nomValide.safeParse(nom);
  if (!n.success) return { ok: false, message: n.error.issues[0].message };
  if (!estUuid(id)) return { ok: false, message: "Cette discipline n’existe plus." };
  if (await nomDisciplinePris(tx, n.data, id)) return { ok: false, message: "Cette discipline existe déjà." };
  const lignes = await tx
    .update(discipline)
    .set({ name: n.data })
    .where(eq(discipline.id, id))
    .returning({ id: discipline.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Cette discipline n’existe plus." };
}

/** Refusé tant qu'un cours ou un tarif l'utilise. */
export async function supprimerDiscipline(tx: Tx, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Cette discipline n’existe plus." };
  const d = (await listerDisciplines(tx)).find((x) => x.id === id);
  if (!d) return { ok: false, message: "Cette discipline n’existe plus." };
  if (d.cours > 0 || d.tarifs > 0) {
    return {
      ok: false,
      message: `${d.nom} est utilisée (${d.cours} cours, ${d.tarifs} tarif${d.tarifs > 1 ? "s" : ""}) : retirez-les d’abord.`,
    };
  }
  await tx.delete(discipline).where(eq(discipline.id, id));
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Sites et salles
// ---------------------------------------------------------------------------

export type LigneSalle = { id: string; nom: string; capacite: number | null; cours: number };
export type LigneSite = {
  id: string;
  nom: string;
  adresse: string;
  permanence: boolean;
  salles: LigneSalle[];
  horaires: Horaire[];
};

export async function listerLieux(tx: Tx): Promise<LigneSite[]> {
  const sites = await tx
    .select({ id: site.id, nom: site.name, adresse: site.address, permanence: site.enrollmentDesk })
    .from(site)
    .orderBy(asc(site.name));
  const idSalle = sql`${room}.${sql.identifier("id")}`;
  const salles = await tx
    .select({
      id: room.id,
      siteId: room.siteId,
      nom: room.name,
      capacite: room.capacity,
      cours: compte(sql`SELECT count(*) FROM course c WHERE c.room_id = ${idSalle}`),
    })
    .from(room)
    .orderBy(asc(room.name));
  const horaires = await horairesParSite(tx);
  return sites.map((s) => ({
    ...s,
    horaires: horaires[s.id] ?? [],
    salles: salles
      .filter((x) => x.siteId === s.id)
      .map((x) => ({ id: x.id, nom: x.nom, capacite: x.capacite, cours: x.cours })),
  }));
}

export const saisieSiteValide = z.object({
  nom: nomValide,
  adresse: z.string().trim().min(1, "Adresse obligatoire").max(300),
  permanence: z.boolean(),
});

/** Site columns from the form input. */
const ligneSite = (s: z.output<typeof saisieSiteValide>) => ({
  name: s.nom,
  address: s.adresse,
  enrollmentDesk: s.permanence,
});

export async function creerSite(tx: Tx, saisie: z.input<typeof saisieSiteValide>): Promise<Resultat> {
  const s = saisieSiteValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const [{ id }] = await tx
    .insert(site)
    .values({ ...ligneSite(s.data), schoolId: ECOLE_COURANTE })
    .returning({ id: site.id });
  return { ok: true, id };
}

export async function modifierSite(tx: Tx, id: string, saisie: z.input<typeof saisieSiteValide>): Promise<Resultat> {
  const s = saisieSiteValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!estUuid(id)) return { ok: false, message: "Ce site n’existe plus." };
  const lignes = await tx.update(site).set(ligneSite(s.data)).where(eq(site.id, id)).returning({ id: site.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Ce site n’existe plus." };
}

/** Refusé tant que le site a des salles. */
export async function supprimerSite(tx: Tx, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Ce site n’existe plus." };
  const [s] = await tx.select({ nom: site.name }).from(site).where(eq(site.id, id));
  if (!s) return { ok: false, message: "Ce site n’existe plus." };
  const [x] = await tx.select({ id: room.id }).from(room).where(eq(room.siteId, id)).limit(1);
  if (x) return { ok: false, message: `${s.nom} a encore des salles : retirez-les d’abord.` };
  await tx.delete(site).where(eq(site.id, id));
  return { ok: true, id };
}

/** Horaires de chaque site, par identifiant de site (jours dans l'ordre). */
export async function horairesParSite(tx: Tx): Promise<Record<string, Horaire[]>> {
  const lignes = await tx
    .select({
      siteId: siteHours.siteId,
      jourSemaine: siteHours.weekday,
      ouverture: siteHours.opensAt,
      fermeture: siteHours.closesAt,
    })
    .from(siteHours)
    .orderBy(asc(siteHours.weekday));
  const r: Record<string, Horaire[]> = {};
  for (const l of lignes)
    (r[l.siteId] ??= []).push({
      jourSemaine: l.jourSemaine,
      ouverture: l.ouverture.slice(0, 5),
      fermeture: l.fermeture.slice(0, 5),
    });
  return r;
}

const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM");
export const horairesValides = z
  .array(z.object({ jourSemaine: z.int().min(1).max(7), ouverture: heure, fermeture: heure }))
  .max(7)
  .refine((h) => new Set(h.map((x) => x.jourSemaine)).size === h.length, "Un même jour est saisi deux fois.")
  .refine((h) => h.every((x) => x.fermeture > x.ouverture), "L’heure de fermeture doit suivre l’ouverture.");

/** Remplace les horaires d'un site ; une liste vide retire toute contrainte d'horaires. */
export async function enregistrerHoraires(
  tx: Tx,
  siteId: string,
  saisie: z.input<typeof horairesValides>,
): Promise<Resultat> {
  const h = horairesValides.safeParse(saisie);
  if (!h.success) return { ok: false, message: h.error.issues[0].message };
  if (!estUuid(siteId)) return { ok: false, message: "Ce site n’existe plus." };
  const [s] = await tx.select({ id: site.id }).from(site).where(eq(site.id, siteId));
  if (!s) return { ok: false, message: "Ce site n’existe plus." };
  await tx.delete(siteHours).where(eq(siteHours.siteId, siteId));
  if (h.data.length > 0)
    await tx.insert(siteHours).values(
      h.data.map((x) => ({
        weekday: x.jourSemaine,
        opensAt: x.ouverture,
        closesAt: x.fermeture,
        siteId,
        schoolId: ECOLE_COURANTE,
      })),
    );
  return { ok: true, id: siteId };
}

export const saisieSalleValide = z.object({
  siteId: z.uuid(),
  nom: nomValide,
  capacite: z.int().min(1).max(1000).nullable(),
});

/** Room columns from the form input. */
const ligneSalle = (s: z.output<typeof saisieSalleValide>) => ({ siteId: s.siteId, name: s.nom, capacity: s.capacite });

export async function creerSalle(tx: Tx, saisie: z.input<typeof saisieSalleValide>): Promise<Resultat> {
  const s = saisieSalleValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.data.siteId));
  if (!x) return { ok: false, message: "Site introuvable." };
  const [{ id }] = await tx
    .insert(room)
    .values({ ...ligneSalle(s.data), schoolId: ECOLE_COURANTE })
    .returning({ id: room.id });
  return { ok: true, id };
}

export async function modifierSalle(tx: Tx, id: string, saisie: z.input<typeof saisieSalleValide>): Promise<Resultat> {
  const s = saisieSalleValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!estUuid(id)) return { ok: false, message: "Cette salle n’existe plus." };
  const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.data.siteId));
  if (!x) return { ok: false, message: "Site introuvable." };
  const lignes = await tx.update(room).set(ligneSalle(s.data)).where(eq(room.id, id)).returning({ id: room.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Cette salle n’existe plus." };
}

/** Refusé tant qu'un cours (de n'importe quelle saison) a lieu dans la salle. */
export async function supprimerSalle(tx: Tx, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Cette salle n’existe plus." };
  const [s] = await tx.select({ nom: room.name }).from(room).where(eq(room.id, id));
  if (!s) return { ok: false, message: "Cette salle n’existe plus." };
  const [c] = await tx.select({ id: course.id }).from(course).where(eq(course.roomId, id)).limit(1);
  if (c) return { ok: false, message: `Des cours ont lieu dans ${s.nom} : déplacez-les d’abord.` };
  await tx.delete(room).where(eq(room.id, id));
  return { ok: true, id };
}
