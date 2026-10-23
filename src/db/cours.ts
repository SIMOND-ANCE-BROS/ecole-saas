import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { horairesParSite } from "./parametres";
import { course, courseDate, discipline, enrollmentCourse, instructor, attendance, room, lesson, site } from "./schema";

/** Édition du planning (cours, disciplines, salles), toujours avec la transaction d'`avecEcole()` (RLS). */

export const TYPES_COURS = {
  collectif: "Collectif",
  particulier: "Particulier",
  competition: "Compétition",
  stage: "Stage",
} as const;

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const nomCourt = z.string().trim().min(1).max(100);
const entierOuNul = (min: number, max: number) => z.int().min(min).max(max).nullable();
const dateOuNulle = z.iso.date("Date invalide").nullable();

/** Récurrences proposées (#90). */
export const RECURRENCES = {
  hebdomadaire: "Chaque semaine",
  quinzaine: "Une semaine sur deux",
  dates: "À des dates précises",
} as const;

export const saisieCoursValide = z
  .object({
    discipline: z.union([z.object({ id: z.uuid() }), z.object({ nom: nomCourt })]),
    salle: z.union([
      z.object({ id: z.uuid() }),
      z.object({
        nom: nomCourt,
        capacite: entierOuNul(1, 1000),
        site: z.union([
          z.object({ id: z.uuid() }),
          z.object({ nom: nomCourt, adresse: z.string().trim().min(1).max(300) }),
        ]),
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
  .refine((c) => c.recurrence === "dates" || c.jourSemaine !== null, {
    path: ["jourSemaine"],
    message: "Jour obligatoire",
  })
  .refine((c) => c.recurrence !== "dates" || c.dates.length > 0, {
    path: ["dates"],
    message: "Ajoutez au moins une date",
  })
  .refine((c) => c.dateDebut === null || c.dateFin === null || c.dateDebut <= c.dateFin, {
    path: ["dateFin"],
    message: "La fin précède le début",
  });

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
  SELECT array_agg(cd.date::text ORDER BY cd.date) FROM course_date cd WHERE cd.course_id = ${course}.${sql.identifier("id")}), '{}')`;

export async function lireCours(tx: Tx, id: string): Promise<CoursEdite | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [c] = await tx
    .select({
      id: course.id,
      saisonId: course.seasonId,
      disciplineId: course.disciplineId,
      discipline: discipline.name,
      salleId: course.roomId,
      intervenantId: course.instructorId,
      type: course.type,
      recurrence: course.recurrence,
      jourSemaine: course.weekday,
      dateDebut: course.startDate,
      dateFin: course.endDate,
      dates: datesDuCoursSql,
      heureDebut: course.startTime,
      dureeMinutes: course.durationMinutes,
      ageMin: course.ageMin,
      ageMax: course.ageMax,
      niveau: course.level,
      capaciteMax: course.maxCapacity,
    })
    .from(course)
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .where(eq(course.id, id));
  return c ? { ...c, heureDebut: c.heureDebut.slice(0, 5) } : null;
}

/** Choix proposés dans le formulaire de cours. `inclure` : intervenant à garder même inactif. */
export async function referentielPlanning(tx: Tx, inclure?: string) {
  const [disciplines, salles, sites, intervenants] = [
    await tx.select({ id: discipline.id, nom: discipline.name }).from(discipline).orderBy(asc(discipline.name)),
    await tx
      .select({ id: room.id, nom: room.name, site: site.name, siteId: site.id, capacite: room.capacity })
      .from(room)
      .innerJoin(site, eq(site.id, room.siteId))
      .orderBy(asc(site.name), asc(room.name)),
    await tx.select({ id: site.id, nom: site.name }).from(site).orderBy(asc(site.name)),
    await tx
      .select({ id: instructor.id, prenom: instructor.firstName, nom: instructor.lastName, actif: instructor.active })
      .from(instructor)
      .where(inclure ? or(eq(instructor.active, true), eq(instructor.id, inclure)) : eq(instructor.active, true))
      .orderBy(asc(instructor.firstName), asc(instructor.lastName)),
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
  const [x] = await tx
    .select({ id: discipline.id })
    .from(discipline)
    .where(sql`lower(${discipline.name}) = lower(${nom})`);
  if (x) return x.id;
  const [n] = await tx
    .insert(discipline)
    .values({ schoolId: ECOLE_COURANTE, name: nom })
    .returning({ id: discipline.id });
  return n.id;
}

/** Salle choisie, ou créée avec son site (existant ou nouveau). */
async function resoudreSalle(tx: Tx, s: SaisieCours["salle"]): Promise<string | null> {
  if ("id" in s) {
    const [x] = await tx.select({ id: room.id }).from(room).where(eq(room.id, s.id));
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
      .values({ schoolId: ECOLE_COURANTE, name: s.site.nom, address: s.site.adresse })
      .returning({ id: site.id });
  }
  const [n] = await tx
    .insert(room)
    .values({ schoolId: ECOLE_COURANTE, siteId, name: s.nom, capacity: s.capacite })
    .returning({ id: room.id });
  return n.id;
}

/** Résout discipline, salle et intervenant ; un intervenant inactif n'est accepté que s'il est `garde`. */
async function valeurs(tx: Tx, saisie: SaisieCours, garde?: string) {
  const [i] = await tx
    .select({ id: instructor.id })
    .from(instructor)
    .where(
      and(
        eq(instructor.id, saisie.intervenantId),
        garde ? or(eq(instructor.active, true), eq(instructor.id, garde)) : eq(instructor.active, true),
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
    // Course columns, ready for insert/update.
    valeurs: {
      disciplineId,
      roomId: salleId,
      instructorId: intervenantId,
      type,
      recurrence,
      weekday: jourSemaine,
      startDate: dateDebut,
      endDate: dateFin,
      startTime: heureDebut,
      durationMinutes: dureeMinutes,
      ageMin,
      ageMax,
      level: niveau,
      maxCapacity: capaciteMax,
    },
    dates: ponctuel ? [...new Set(saisie.dates)].sort() : [],
  };
}

export async function creerCours(tx: Tx, saisonId: string, saisie: SaisieCours): Promise<Resultat> {
  const r = await valeurs(tx, saisie);
  if (!r.ok) return r;
  const [{ id }] = await tx
    .insert(course)
    .values({ ...r.valeurs, schoolId: ECOLE_COURANTE, seasonId: saisonId })
    .returning({ id: course.id });
  await remplacerDates(tx, id, r.dates);
  return { ok: true, id };
}

async function remplacerDates(tx: Tx, coursId: string, dates: string[]) {
  await tx.delete(courseDate).where(eq(courseDate.courseId, coursId));
  if (dates.length > 0)
    await tx.insert(courseDate).values(dates.map((date) => ({ schoolId: ECOLE_COURANTE, courseId: coursId, date })));
}

export async function modifierCours(tx: Tx, id: string, saisie: SaisieCours): Promise<Resultat> {
  const existant = await lireCours(tx, id);
  if (!existant) return { ok: false, message: "Ce cours n’existe plus." };
  const r = await valeurs(tx, saisie, existant.intervenantId);
  if (!r.ok) return r;
  await tx.update(course).set(r.valeurs).where(eq(course.id, id));
  await remplacerDates(tx, id, r.dates);
  // Nouveau titulaire : il reprend les séances à venir de l'ancien, pas celles d'un remplaçant.
  if (r.valeurs.instructorId !== existant.intervenantId) {
    await tx
      .update(lesson)
      .set({ instructorId: r.valeurs.instructorId })
      .where(
        and(
          eq(lesson.courseId, id),
          eq(lesson.instructorId, existant.intervenantId),
          eq(lesson.status, "prevue"),
          sql`${lesson.date} >= (now() AT TIME ZONE 'Europe/Paris')::date`,
        ),
      );
  }
  return { ok: true, id };
}

/** Refusée dès qu'une inscription, quel que soit son statut, porte sur le cours. */
export async function supprimerCours(tx: Tx, id: string): Promise<Resultat> {
  if (!(await lireCours(tx, id))) return { ok: false, message: "Ce cours n’existe plus." };
  const [{ n }] = await tx
    .select({ n: sql<number>`count(DISTINCT ${enrollmentCourse.enrollmentId})::int` })
    .from(enrollmentCourse)
    .where(eq(enrollmentCourse.courseId, id));
  if (n > 0)
    return { ok: false, message: `Ce cours a ${n} inscription${n > 1 ? "s" : ""} : il ne peut pas être supprimé.` };
  const [appel] = await tx
    .select({ seanceId: attendance.lessonId })
    .from(attendance)
    .innerJoin(lesson, eq(lesson.id, attendance.lessonId))
    .where(eq(lesson.courseId, id))
    .limit(1);
  if (appel) return { ok: false, message: "Des appels ont été faits pour ce cours : il ne peut pas être supprimé." };
  await tx.delete(lesson).where(eq(lesson.courseId, id));
  await tx.delete(course).where(eq(course.id, id));
  return { ok: true, id };
}

export const creneauValide = z.object({
  jourSemaine: z.int().min(1).max(7),
  heureDebut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
  dureeMinutes: z.int().min(5).max(600),
});

export type ResultatDeplacement =
  { statut: "ok"; id: string } | { statut: "confirmer"; inscrits: number } | { statut: "refus"; message: string };

/**
 * Déplace (jour, heure) ou étire (durée) un cours depuis la vue agenda. Si des
 * élèves y sont inscrits (actifs ou à l'essai), il faut d'abord confirmer.
 * Les séances à venir sont recalculées par l'appelant (synchroniserSeances).
 */
export async function deplacerCours(
  tx: Tx,
  id: string,
  creneau: z.input<typeof creneauValide>,
  confirme: boolean,
): Promise<ResultatDeplacement> {
  const c = creneauValide.safeParse(creneau);
  if (!c.success) return { statut: "refus", message: c.error.issues[0].message };
  const existant = await lireCours(tx, id);
  if (!existant) return { statut: "refus", message: "Ce cours n’existe plus." };
  if (existant.recurrence === "dates")
    return { statut: "refus", message: "Un cours à dates précises se modifie depuis sa fiche." };
  if (versMinutesFin(c.data) > 24 * 60) return { statut: "refus", message: "Le cours finirait après minuit." };
  if (!confirme) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(DISTINCT ${enrollmentCourse.studentId})::int` })
      .from(enrollmentCourse)
      .innerJoin(sql`enrollment i`, sql`i.id = ${enrollmentCourse.enrollmentId} AND i.status IN ('active', 'essai')`)
      .where(eq(enrollmentCourse.courseId, id));
    if (n > 0) return { statut: "confirmer", inscrits: n };
  }
  await tx
    .update(course)
    .set({ weekday: c.data.jourSemaine, startTime: c.data.heureDebut, durationMinutes: c.data.dureeMinutes })
    .where(eq(course.id, id));
  return { statut: "ok", id };
}

const versMinutesFin = (c: { heureDebut: string; dureeMinutes: number }) =>
  Number(c.heureDebut.slice(0, 2)) * 60 + Number(c.heureDebut.slice(3, 5)) + c.dureeMinutes;
