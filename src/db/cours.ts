import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { horairesParSite } from "./parametres";
import { cours, coursDate, discipline, inscriptionCours, intervenant, presence, salle, seance, site } from "./schema";

/** Édition du planning (cours, disciplines, salles), toujours avec la transaction d'`avecEcole()` (RLS). */

export const TYPES_COURS = { collectif: "Collectif", particulier: "Particulier", competition: "Compétition", stage: "Stage" } as const;

const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;
const nomCourt = z.string().trim().min(1).max(100);
const entierOuNul = (min: number, max: number) => z.int().min(min).max(max).nullable();
const dateOuNulle = z.iso.date("Date invalide").nullable();

/** Récurrences proposées (#90). */
export const RECURRENCES = { hebdomadaire: "Chaque semaine", quinzaine: "Une semaine sur deux", dates: "À des dates précises" } as const;

export const saisieCoursValide = z
  .object({
    discipline: z.union([z.object({ id: z.uuid() }), z.object({ nom: nomCourt })]),
    salle: z.union([
      z.object({ id: z.uuid() }),
      z.object({
        nom: nomCourt,
        capacite: entierOuNul(1, 1000),
        site: z.union([z.object({ id: z.uuid() }), z.object({ nom: nomCourt, adresse: z.string().trim().min(1).max(300) })]),
      }),
    ]),
    intervenantId: z.uuid(),
    type: z.enum(["collectif", "particulier", "competition", "stage"]),
    recurrence: z.enum(["hebdomadaire", "quinzaine", "dates"]),
    jourSemaine: entierOuNul(1, 7),
    dateDebut: dateOuNulle,
    dateFin: dateOuNulle,
    dates: z.array(z.iso.date("Date invalide")).max(100, "100 dates au plus"),
    heureDebut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
    dureeMinutes: z.int().min(5).max(600),
    ageMin: entierOuNul(0, 120),
    ageMax: entierOuNul(0, 120),
    niveau: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .transform((v) => v || null),
    capaciteMax: entierOuNul(1, 1000),
  })
  .refine((c) => c.ageMin === null || c.ageMax === null || c.ageMin <= c.ageMax, {
    path: ["ageMax"],
    message: "L’âge maximum est inférieur à l’âge minimum",
  })
  .refine((c) => c.recurrence === "dates" || c.jourSemaine !== null, { path: ["jourSemaine"], message: "Jour obligatoire" })
  .refine((c) => c.recurrence !== "dates" || c.dates.length > 0, { path: ["dates"], message: "Ajoutez au moins une date" })
  .refine((c) => c.dateDebut === null || c.dateFin === null || c.dateDebut <= c.dateFin, { path: ["dateFin"], message: "La fin précède le début" });

export type SaisieCours = z.output<typeof saisieCoursValide>;
export type Resultat = { ok: true; id: string } | { ok: false; message: string };

export type CoursEdite = {
  id: string;
  saisonId: string;
  disciplineId: string;
  discipline: string;
  salleId: string;
  intervenantId: string;
  type: keyof typeof TYPES_COURS;
  recurrence: keyof typeof RECURRENCES;
  jourSemaine: number | null;
  dateDebut: string | null;
  dateFin: string | null;
  /** Dates d'un cours ponctuel, triées. */
  dates: string[];
  heureDebut: string;
  dureeMinutes: number;
  ageMin: number | null;
  ageMax: number | null;
  niveau: string | null;
  capaciteMax: number | null;
};

/** Dates d'un cours ponctuel, triées (texte `YYYY-MM-DD`). */
export const datesDuCoursSql = sql<string[]>`coalesce((
  SELECT array_agg(cd.date::text ORDER BY cd.date) FROM cours_date cd WHERE cd.cours_id = ${cours}.${sql.identifier("id")}), '{}')`;

export async function lireCours(tx: Tx, id: string): Promise<CoursEdite | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [c] = await tx
    .select({
      id: cours.id,
      saisonId: cours.saisonId,
      disciplineId: cours.disciplineId,
      discipline: discipline.nom,
      salleId: cours.salleId,
      intervenantId: cours.intervenantId,
      type: cours.type,
      recurrence: cours.recurrence,
      jourSemaine: cours.jourSemaine,
      dateDebut: cours.dateDebut,
      dateFin: cours.dateFin,
      dates: datesDuCoursSql,
      heureDebut: cours.heureDebut,
      dureeMinutes: cours.dureeMinutes,
      ageMin: cours.ageMin,
      ageMax: cours.ageMax,
      niveau: cours.niveau,
      capaciteMax: cours.capaciteMax,
    })
    .from(cours)
    .innerJoin(discipline, eq(discipline.id, cours.disciplineId))
    .where(eq(cours.id, id));
  return c ? { ...c, heureDebut: c.heureDebut.slice(0, 5) } : null;
}

/** Choix proposés dans le formulaire de cours. `inclure` : intervenant à garder même inactif. */
export async function referentielPlanning(tx: Tx, inclure?: string) {
  const [disciplines, salles, sites, intervenants] = [
    await tx.select({ id: discipline.id, nom: discipline.nom }).from(discipline).orderBy(asc(discipline.nom)),
    await tx
      .select({ id: salle.id, nom: salle.nom, site: site.nom, siteId: site.id, capacite: salle.capacite })
      .from(salle)
      .innerJoin(site, eq(site.id, salle.siteId))
      .orderBy(asc(site.nom), asc(salle.nom)),
    await tx.select({ id: site.id, nom: site.nom }).from(site).orderBy(asc(site.nom)),
    await tx
      .select({ id: intervenant.id, prenom: intervenant.prenom, nom: intervenant.nom, actif: intervenant.actif })
      .from(intervenant)
      .where(inclure ? or(eq(intervenant.actif, true), eq(intervenant.id, inclure)) : eq(intervenant.actif, true))
      .orderBy(asc(intervenant.prenom), asc(intervenant.nom)),
  ];
  // Horaires d'ouverture par site (#90) : le formulaire prévient d'un créneau qui en sort.
  return { disciplines, salles, sites, intervenants, horaires: await horairesParSite(tx) };
}
export type ReferentielPlanning = Awaited<ReturnType<typeof referentielPlanning>>;

/** Discipline choisie, ou retrouvée par son nom (sans tenir compte de la casse), sinon créée. */
async function resoudreDiscipline(tx: Tx, d: SaisieCours["discipline"]): Promise<string | null> {
  if ("id" in d) {
    const [x] = await tx.select({ id: discipline.id }).from(discipline).where(eq(discipline.id, d.id));
    return x?.id ?? null;
  }
  const nom = d.nom.trim();
  const [x] = await tx.select({ id: discipline.id }).from(discipline).where(sql`lower(${discipline.nom}) = lower(${nom})`);
  if (x) return x.id;
  const [n] = await tx.insert(discipline).values({ ecoleId: ECOLE_COURANTE, nom }).returning({ id: discipline.id });
  return n.id;
}

/** Salle choisie, ou créée avec son site (existant ou nouveau). */
async function resoudreSalle(tx: Tx, s: SaisieCours["salle"]): Promise<string | null> {
  if ("id" in s) {
    const [x] = await tx.select({ id: salle.id }).from(salle).where(eq(salle.id, s.id));
    return x?.id ?? null;
  }
  let siteId: string;
  if ("id" in s.site) {
    const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.site.id));
    if (!x) return null;
    siteId = x.id;
  } else {
    [{ id: siteId }] = await tx
      .insert(site)
      .values({ ecoleId: ECOLE_COURANTE, nom: s.site.nom, adresse: s.site.adresse })
      .returning({ id: site.id });
  }
  const [n] = await tx
    .insert(salle)
    .values({ ecoleId: ECOLE_COURANTE, siteId, nom: s.nom, capacite: s.capacite })
    .returning({ id: salle.id });
  return n.id;
}

/** Résout discipline, salle et intervenant ; un intervenant inactif n'est accepté que s'il est `garde`. */
async function valeurs(tx: Tx, saisie: SaisieCours, garde?: string) {
  const [i] = await tx
    .select({ id: intervenant.id })
    .from(intervenant)
    .where(
      and(
        eq(intervenant.id, saisie.intervenantId),
        garde ? or(eq(intervenant.actif, true), eq(intervenant.id, garde)) : eq(intervenant.actif, true),
      ),
    );
  if (!i) return { ok: false as const, message: "Intervenant introuvable ou inactif." };
  const salleId = await resoudreSalle(tx, saisie.salle);
  if (!salleId) return { ok: false as const, message: "Salle introuvable." };
  const disciplineId = await resoudreDiscipline(tx, saisie.discipline);
  if (!disciplineId) return { ok: false as const, message: "Discipline introuvable." };
  const { intervenantId, type, recurrence, heureDebut, dureeMinutes, ageMin, ageMax, niveau, capaciteMax } = saisie;
  // Dates précises : ni jour ni période ; cours régulier : pas de dates.
  const ponctuel = recurrence === "dates";
  const jourSemaine = ponctuel ? null : saisie.jourSemaine;
  const [dateDebut, dateFin] = ponctuel ? [null, null] : [saisie.dateDebut, saisie.dateFin];
  return {
    ok: true as const,
    valeurs: { disciplineId, salleId, intervenantId, type, recurrence, jourSemaine, dateDebut, dateFin, heureDebut, dureeMinutes, ageMin, ageMax, niveau, capaciteMax },
    dates: ponctuel ? [...new Set(saisie.dates)].sort() : [],
  };
}

export async function creerCours(tx: Tx, saisonId: string, saisie: SaisieCours): Promise<Resultat> {
  const r = await valeurs(tx, saisie);
  if (!r.ok) return r;
  const [{ id }] = await tx
    .insert(cours)
    .values({ ...r.valeurs, ecoleId: ECOLE_COURANTE, saisonId })
    .returning({ id: cours.id });
  await remplacerDates(tx, id, r.dates);
  return { ok: true, id };
}

async function remplacerDates(tx: Tx, coursId: string, dates: string[]) {
  await tx.delete(coursDate).where(eq(coursDate.coursId, coursId));
  if (dates.length > 0) await tx.insert(coursDate).values(dates.map((date) => ({ ecoleId: ECOLE_COURANTE, coursId, date })));
}

export async function modifierCours(tx: Tx, id: string, saisie: SaisieCours): Promise<Resultat> {
  const existant = await lireCours(tx, id);
  if (!existant) return { ok: false, message: "Ce cours n’existe plus." };
  const r = await valeurs(tx, saisie, existant.intervenantId);
  if (!r.ok) return r;
  await tx.update(cours).set(r.valeurs).where(eq(cours.id, id));
  await remplacerDates(tx, id, r.dates);
  // Nouveau titulaire : il reprend les séances à venir de l'ancien, pas celles d'un remplaçant.
  if (r.valeurs.intervenantId !== existant.intervenantId) {
    await tx
      .update(seance)
      .set({ intervenantId: r.valeurs.intervenantId })
      .where(
        and(
          eq(seance.coursId, id),
          eq(seance.intervenantId, existant.intervenantId),
          eq(seance.statut, "prevue"),
          sql`${seance.date} >= (now() AT TIME ZONE 'Europe/Paris')::date`,
        ),
      );
  }
  return { ok: true, id };
}

/** Refusée dès qu'une inscription, quel que soit son statut, porte sur le cours. */
export async function supprimerCours(tx: Tx, id: string): Promise<Resultat> {
  if (!(await lireCours(tx, id))) return { ok: false, message: "Ce cours n’existe plus." };
  const [{ n }] = await tx
    .select({ n: sql<number>`count(DISTINCT ${inscriptionCours.inscriptionId})::int` })
    .from(inscriptionCours)
    .where(eq(inscriptionCours.coursId, id));
  if (n > 0) return { ok: false, message: `Ce cours a ${n} inscription${n > 1 ? "s" : ""} : il ne peut pas être supprimé.` };
  const [appel] = await tx
    .select({ seanceId: presence.seanceId })
    .from(presence)
    .innerJoin(seance, eq(seance.id, presence.seanceId))
    .where(eq(seance.coursId, id))
    .limit(1);
  if (appel) return { ok: false, message: "Des appels ont été faits pour ce cours : il ne peut pas être supprimé." };
  await tx.delete(seance).where(eq(seance.coursId, id));
  await tx.delete(cours).where(eq(cours.id, id));
  return { ok: true, id };
}

export const creneauValide = z.object({
  jourSemaine: z.int().min(1).max(7),
  heureDebut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
  dureeMinutes: z.int().min(5).max(600),
});

export type ResultatDeplacement =
  | { statut: "ok"; id: string }
  | { statut: "confirmer"; inscrits: number }
  | { statut: "refus"; message: string };

/**
 * Déplace (jour, heure) ou étire (durée) un cours depuis la vue agenda. Si des
 * élèves y sont inscrits (actifs ou à l'essai), il faut d'abord confirmer.
 * Les séances à venir sont recalculées par l'appelant (synchroniserSeances).
 */
export async function deplacerCours(tx: Tx, id: string, creneau: z.input<typeof creneauValide>, confirme: boolean): Promise<ResultatDeplacement> {
  const c = creneauValide.safeParse(creneau);
  if (!c.success) return { statut: "refus", message: c.error.issues[0].message };
  const existant = await lireCours(tx, id);
  if (!existant) return { statut: "refus", message: "Ce cours n’existe plus." };
  if (existant.recurrence === "dates") return { statut: "refus", message: "Un cours à dates précises se modifie depuis sa fiche." };
  if (versMinutesFin(c.data) > 24 * 60) return { statut: "refus", message: "Le cours finirait après minuit." };
  if (!confirme) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(DISTINCT ${inscriptionCours.danseurId})::int` })
      .from(inscriptionCours)
      .innerJoin(sql`inscription i`, sql`i.id = ${inscriptionCours.inscriptionId} AND i.statut IN ('active', 'essai')`)
      .where(eq(inscriptionCours.coursId, id));
    if (n > 0) return { statut: "confirmer", inscrits: n };
  }
  await tx.update(cours).set(c.data).where(eq(cours.id, id));
  return { statut: "ok", id };
}

const versMinutesFin = (c: { heureDebut: string; dureeMinutes: number }) =>
  Number(c.heureDebut.slice(0, 2)) * 60 + Number(c.heureDebut.slice(3, 5)) + c.dureeMinutes;
