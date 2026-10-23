import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { datesDuCours, type Recurrence } from "../domaine/planning/seances";
import type { Tx } from "./index";
import {
  course,
  courseDate,
  discipline,
  closure,
  enrollment,
  enrollmentCourse,
  instructor,
  person,
  attendance,
  season,
  room,
  lesson,
} from "./schema";

/**
 * Séances (occurrences datées des cours), fermetures et appel. Toujours avec
 * la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
export type Resultat = { ok: true; id: string } | { ok: false; message: string };

/** Danseurs qui figurent à l'appel : inscrits ou à l'essai, jamais en liste d'attente. */
const STATUTS_A_L_APPEL = ["active", "essai"] as const;

// ---------------------------------------------------------------------------
// Fermetures
// ---------------------------------------------------------------------------

export type Fermeture = { id: string; libelle: string; debut: string; fin: string };

export const saisieFermetureValide = z.object({
  libelle: z.string().trim().min(1, "Libellé obligatoire").max(100),
  debut: z.iso.date("Date invalide"),
  fin: z.iso.date("Date invalide"),
});

export function listerFermetures(tx: Tx, saisonId: string): Promise<Fermeture[]> {
  return tx
    .select({ id: closure.id, libelle: closure.label, debut: closure.startDate, fin: closure.endDate })
    .from(closure)
    .where(eq(closure.seasonId, saisonId))
    .orderBy(asc(closure.startDate));
}

export async function ajouterFermeture(
  tx: Tx,
  saisonId: string,
  saisie: z.input<typeof saisieFermetureValide>,
): Promise<Resultat> {
  const f = saisieFermetureValide.safeParse(saisie);
  if (!f.success) return { ok: false, message: f.error.issues[0].message };
  if (f.data.fin < f.data.debut) return { ok: false, message: "La fin précède le début." };
  const [{ id }] = await tx
    .insert(closure)
    .values({
      label: f.data.libelle,
      startDate: f.data.debut,
      endDate: f.data.fin,
      seasonId: saisonId,
      schoolId: ECOLE_COURANTE,
    })
    .returning({ id: closure.id });
  return { ok: true, id };
}

export async function supprimerFermeture(tx: Tx, id: string): Promise<Resultat> {
  const refus = { ok: false as const, message: "Cette fermeture n’existe plus." };
  if (!estUuid(id)) return refus;
  const lignes = await tx.delete(closure).where(eq(closure.id, id)).returning({ id: closure.id });
  return lignes.length === 1 ? { ok: true, id } : refus;
}

// ---------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------

/** Heure (texte `HH:MM:SS`) et durée effectives d'une séance : les siennes si elle a été déplacée (#90), sinon celles du cours. */
export const heureEffective = sql<string>`coalesce(${lesson.startTime}, ${course.startTime})::text`;
export const dureeEffective = sql<number>`coalesce(${lesson.durationMinutes}, ${course.durationMinutes})`;

const avecAppel = sql`EXISTS (SELECT 1 FROM attendance p WHERE p.lesson_id = ${lesson}.${sql.identifier("id")})`;

/**
 * Met les séances à venir de la saison en accord avec les cours et les
 * fermetures : crée celles qui manquent (titulaire du cours) et retire les
 * séances prévues devenues sans objet. Le passé, les séances annulées et
 * celles dont l'appel est fait ne sont jamais touchés. Une séance déplacée
 * (#90) se repère à sa date d'origine (`date_prevue`) : elle n'est ni recréée
 * à cette date, ni retirée. `depuis` : ne régénérer qu'à partir de cette date
 * (déplacement d'une séance « et des suivantes »).
 */
export async function synchroniserSeances(
  tx: Tx,
  saisonId: string,
  aujourdhui: string,
  depuis?: string,
): Promise<{ ajoutees: number; retirees: number }> {
  const [s] = await tx
    .select({ debut: season.startDate, fin: season.endDate })
    .from(season)
    .where(eq(season.id, saisonId));
  if (!s) return { ajoutees: 0, retirees: 0 };
  const debut = [s.debut, aujourdhui, depuis ?? ""].reduce((a, b) => (b > a ? b : a));
  const fermetures = await listerFermetures(tx, saisonId);
  const tous = await tx
    .select({
      id: course.id,
      recurrence: course.recurrence,
      jourSemaine: course.weekday,
      dateDebut: course.startDate,
      dateFin: course.endDate,
      intervenantId: course.instructorId,
    })
    .from(course)
    .where(eq(course.seasonId, saisonId));
  const ponctuelles = await tx
    .select({ coursId: courseDate.courseId, date: courseDate.date })
    .from(courseDate)
    .innerJoin(course, eq(course.id, courseDate.courseId))
    .where(eq(course.seasonId, saisonId));

  // Toute la saison, puis à partir de `debut` : l'alternance « une semaine sur deux » se cale sur la première date.
  const attendues = tous.flatMap((c) => {
    const r: Recurrence =
      c.recurrence === "dates"
        ? { type: "dates", dates: ponctuelles.filter((p) => p.coursId === c.id).map((p) => p.date) }
        : { type: c.recurrence, jourSemaine: c.jourSemaine as number, dateDebut: c.dateDebut, dateFin: c.dateFin };
    return datesDuCours(r, { debut: s.debut, fin: s.fin }, fermetures)
      .filter((date) => date >= debut)
      .map((date) => ({ coursId: c.id, date, intervenantId: c.intervenantId }));
  });
  const repere = sql<string>`coalesce(${lesson.plannedDate}, ${lesson.date})::text`;
  const existantes = await tx
    .select({
      id: lesson.id,
      coursId: lesson.courseId,
      repere,
      statut: lesson.status,
      appel: sql<boolean>`${avecAppel}`,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(eq(course.seasonId, saisonId));
  const presentes = new Set(existantes.map((e) => `${e.coursId} ${e.repere}`));
  const manquantes = attendues.filter((a) => !presentes.has(`${a.coursId} ${a.date}`));
  const ajoutees =
    manquantes.length === 0
      ? []
      : await tx
          .insert(lesson)
          .values(
            manquantes.map((a) => ({
              courseId: a.coursId,
              date: a.date,
              instructorId: a.intervenantId,
              schoolId: ECOLE_COURANTE,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: lesson.id });

  const voulues = new Set(attendues.map((a) => `${a.coursId} ${a.date}`));
  const aRetirer = existantes
    .filter((e) => e.repere >= debut && e.statut === "prevue" && !e.appel && !voulues.has(`${e.coursId} ${e.repere}`))
    .map((e) => e.id);
  if (aRetirer.length > 0) await tx.delete(lesson).where(inArray(lesson.id, aRetirer));
  return { ajoutees: ajoutees.length, retirees: aRetirer.length };
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

const comptePresences = (present: boolean) => sql<number>`(
  SELECT count(*)::int FROM attendance p WHERE p.lesson_id = ${lesson}.${sql.identifier("id")} AND p.present = ${present}
)`;

export type SeanceCours = {
  id: string;
  date: string;
  statut: "prevue" | "effectuee" | "annulee";
  intervenant: string;
  presents: number;
  absents: number;
};

/** Séances d'un cours, par date. */
export async function seancesDuCours(tx: Tx, coursId: string): Promise<SeanceCours[]> {
  if (!estUuid(coursId)) return [];
  const lignes = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      statut: lesson.status,
      prenom: instructor.firstName,
      nom: instructor.lastName,
      presents: comptePresences(true),
      absents: comptePresences(false),
    })
    .from(lesson)
    .innerJoin(instructor, eq(instructor.id, lesson.instructorId))
    .where(eq(lesson.courseId, coursId))
    .orderBy(asc(lesson.date));
  return lignes.map(({ prenom, nom, ...l }) => ({ ...l, intervenant: `${prenom} ${nom}` }));
}

export type SeanceDuJour = {
  id: string;
  coursId: string;
  heureDebut: string;
  dureeMinutes: number;
  discipline: string;
  niveau: string | null;
  salle: string;
  intervenant: string;
  statut: SeanceCours["statut"];
  appelFait: boolean;
};

/** Séances d'une journée, par heure : pour lancer l'appel depuis l'accueil. */
export async function seancesDuJour(tx: Tx, date: string): Promise<SeanceDuJour[]> {
  const lignes = await tx
    .select({
      id: lesson.id,
      coursId: course.id,
      heureDebut: heureEffective,
      dureeMinutes: dureeEffective,
      discipline: discipline.name,
      niveau: course.level,
      salle: room.name,
      prenom: instructor.firstName,
      nom: instructor.lastName,
      statut: lesson.status,
      appelFait: sql<boolean>`${avecAppel}`,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .innerJoin(instructor, eq(instructor.id, lesson.instructorId))
    .where(eq(lesson.date, date))
    .orderBy(heureEffective, asc(discipline.name));
  return lignes.map(({ prenom, nom, heureDebut, ...l }) => ({
    ...l,
    heureDebut: heureDebut.slice(0, 5),
    intervenant: `${prenom} ${nom}`,
  }));
}

export type Appel = {
  id: string;
  date: string;
  statut: SeanceCours["statut"];
  coursId: string;
  discipline: string;
  niveau: string | null;
  heureDebut: string;
  dureeMinutes: number;
  salle: string;
  intervenantId: string;
  titulaireId: string;
  danseurs: {
    id: string;
    prenom: string;
    nom: string;
    dateNaissance: string | null;
    notes: string | null;
    statut: (typeof STATUTS_A_L_APPEL)[number];
    /** null tant que l'appel n'est pas fait pour ce danseur. */
    present: boolean | null;
  }[];
};

/** Fiche d'appel d'une séance ; null si elle n'existe pas dans l'école courante. */
export async function lireAppel(tx: Tx, seanceId: string): Promise<Appel | null> {
  if (!estUuid(seanceId)) return null;
  const [s] = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      statut: lesson.status,
      coursId: course.id,
      discipline: discipline.name,
      niveau: course.level,
      heureDebut: heureEffective,
      dureeMinutes: dureeEffective,
      salle: room.name,
      intervenantId: lesson.instructorId,
      titulaireId: course.instructorId,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .where(eq(lesson.id, seanceId));
  if (!s) return null;

  const danseurs = await tx
    .selectDistinctOn([person.lastName, person.firstName, person.id], {
      id: person.id,
      prenom: person.firstName,
      nom: person.lastName,
      dateNaissance: person.birthDate,
      notes: person.notes,
      statut: sql<Appel["danseurs"][number]["statut"]>`${enrollment.status}`,
      present: attendance.present,
    })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .innerJoin(person, eq(person.id, enrollmentCourse.studentId))
    .leftJoin(attendance, and(eq(attendance.lessonId, seanceId), eq(attendance.studentId, person.id)))
    .where(and(eq(enrollmentCourse.courseId, s.coursId), inArray(enrollment.status, [...STATUTS_A_L_APPEL])))
    .orderBy(asc(person.lastName), asc(person.firstName), asc(person.id), desc(sql`${enrollment.status} = 'active'`));

  return {
    ...s,
    heureDebut: s.heureDebut.slice(0, 5),
    danseurs: danseurs.map((d) => ({ ...d, prenom: d.prenom ?? d.nom })),
  };
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

export const appelValide = z.array(z.object({ danseurId: z.uuid(), present: z.boolean() })).max(200);

/** Enregistre ou corrige l'appel ; la séance passe « effectuée ». */
export async function enregistrerAppel(
  tx: Tx,
  seanceId: string,
  saisie: z.input<typeof appelValide>,
): Promise<Resultat> {
  const lignes = appelValide.safeParse(saisie);
  if (!lignes.success) return { ok: false, message: "Saisie invalide." };
  const appel = await lireAppel(tx, seanceId);
  if (!appel) return { ok: false, message: "Cette séance n’existe plus." };
  if (appel.statut === "annulee") return { ok: false, message: "Cette séance est annulée." };
  const attendus = new Set(appel.danseurs.map((d) => d.id));
  if (!lignes.data.every((l) => attendus.has(l.danseurId)))
    return { ok: false, message: "Un des danseurs ne suit pas ce cours." };

  if (lignes.data.length > 0) {
    await tx
      .insert(attendance)
      .values(
        lignes.data.map((l) => ({
          studentId: l.danseurId,
          present: l.present,
          lessonId: seanceId,
          schoolId: ECOLE_COURANTE,
        })),
      )
      .onConflictDoUpdate({
        target: [attendance.lessonId, attendance.studentId],
        set: { present: sql`excluded.present` },
      });
  }
  await tx.update(lesson).set({ status: "effectuee" }).where(eq(lesson.id, seanceId));
  return { ok: true, id: seanceId };
}

/** Remplaçant (ou retour du titulaire) pour une séance ; intervenant actif seulement. */
export async function changerIntervenant(tx: Tx, seanceId: string, intervenantId: string): Promise<Resultat> {
  if (!estUuid(seanceId) || !estUuid(intervenantId)) return { ok: false, message: "Saisie invalide." };
  const [i] = await tx
    .select({ id: instructor.id })
    .from(instructor)
    .where(and(eq(instructor.id, intervenantId), eq(instructor.active, true)));
  if (!i) return { ok: false, message: "Intervenant introuvable ou inactif." };
  const lignes = await tx
    .update(lesson)
    .set({ instructorId: intervenantId })
    .where(eq(lesson.id, seanceId))
    .returning({ id: lesson.id });
  return lignes.length === 1 ? { ok: true, id: seanceId } : { ok: false, message: "Cette séance n’existe plus." };
}

/** Annule une séance dont l'appel n'est pas fait ; elle reste visible, barrée. */
export async function annulerSeance(tx: Tx, seanceId: string): Promise<Resultat> {
  const appel = await lireAppel(tx, seanceId);
  if (!appel) return { ok: false, message: "Cette séance n’existe plus." };
  if (appel.danseurs.some((d) => d.present !== null))
    return { ok: false, message: "L’appel de cette séance est déjà fait." };
  await tx.update(lesson).set({ status: "annulee" }).where(eq(lesson.id, seanceId));
  return { ok: true, id: seanceId };
}

/** Rétablit une séance annulée. */
export async function retablirSeance(tx: Tx, seanceId: string): Promise<Resultat> {
  if (!estUuid(seanceId)) return { ok: false, message: "Cette séance n’existe plus." };
  const lignes = await tx
    .update(lesson)
    .set({ status: "prevue" })
    .where(and(eq(lesson.id, seanceId), eq(lesson.status, "annulee")))
    .returning({ id: lesson.id });
  return lignes.length === 1 ? { ok: true, id: seanceId } : { ok: false, message: "Cette séance n’est pas annulée." };
}

// ---------------------------------------------------------------------------
// Planning daté (#90)
// ---------------------------------------------------------------------------

/** Heure et durée effectives d'une séance : les siennes si elle a été déplacée, sinon celles du cours. */
const heureSeance = sql<string>`to_char(coalesce(${lesson.startTime}, ${course.startTime}), 'HH24:MI')`;
const dureeSeance = sql<number>`coalesce(${lesson.durationMinutes}, ${course.durationMinutes})`;

export type SeancePlanning = {
  id: string;
  coursId: string;
  date: string;
  heureDebut: string;
  dureeMinutes: number;
  statut: "prevue" | "effectuee" | "annulee";
  /** Déplacée individuellement (autre date ou autre heure que prévu). */
  deplacee: boolean;
  recurrence: "hebdomadaire" | "quinzaine" | "dates";
  discipline: string;
  salleId: string;
  salle: string;
  siteId: string;
  site: string;
  /** Intervenant de la séance (remplaçant éventuel). */
  intervenantId: string;
  intervenant: string;
  remplacement: boolean;
  inscrits: number;
  capaciteMax: number | null;
};

/** Séances de la semaine qui commence le lundi `lundi`, toutes saisons confondues, par date et heure. */
export async function seancesDeLaSemaine(tx: Tx, lundi: string): Promise<SeancePlanning[]> {
  const dimanche = sql`(${lundi}::date + 6)`;
  const lignes = await tx
    .select({
      id: lesson.id,
      coursId: lesson.courseId,
      date: lesson.date,
      heureDebut: heureSeance,
      dureeMinutes: dureeSeance,
      statut: lesson.status,
      // Déplacée elle-même (pas seulement figée avant un changement du cours) : elle garde sa date d'origine.
      deplacee: sql<boolean>`${lesson.plannedDate} IS NOT NULL`,
      recurrence: course.recurrence,
      discipline: discipline.name,
      salleId: course.roomId,
      salle: room.name,
      siteId: room.siteId,
      site: sql<string>`(SELECT s.name FROM site s WHERE s.id = ${room.siteId})`,
      intervenantId: lesson.instructorId,
      prenom: instructor.firstName,
      nom: instructor.lastName,
      remplacement: sql<boolean>`${lesson.instructorId} <> ${course.instructorId}`,
      inscrits: sql<number>`(
        SELECT count(DISTINCT ic.student_id)::int FROM enrollment_course ic
        JOIN enrollment i ON i.id = ic.enrollment_id AND i.status = 'active'
        WHERE ic.course_id = ${lesson.courseId})`,
      capaciteMax: course.maxCapacity,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .innerJoin(instructor, eq(instructor.id, lesson.instructorId))
    .where(and(sql`${lesson.date} >= ${lundi}::date`, sql`${lesson.date} <= ${dimanche}`))
    .orderBy(asc(lesson.date), sql`coalesce(${lesson.startTime}, ${course.startTime})`, asc(discipline.name));
  return lignes.map(({ prenom, nom, ...l }) => ({ ...l, intervenant: `${prenom} ${nom}` }));
}

/** Fermetures (toutes saisons) qui touchent la période. */
export function fermeturesEntre(
  tx: Tx,
  debut: string,
  fin: string,
): Promise<{ libelle: string; debut: string; fin: string }[]> {
  return tx
    .select({ libelle: closure.label, debut: closure.startDate, fin: closure.endDate })
    .from(closure)
    .where(and(sql`${closure.startDate} <= ${fin}::date`, sql`${closure.endDate} >= ${debut}::date`))
    .orderBy(asc(closure.startDate));
}

export const creneauSeanceValide = z.object({
  date: z.iso.date("Date invalide"),
  heureDebut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
  dureeMinutes: z.int().min(5).max(600),
});

export type ResultatSeance =
  { statut: "ok"; saisonId: string; depuis: string | null } | { statut: "refus"; message: string };

const jourIso = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const decaler = (iso: string, jours: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);

/**
 * Déplace une séance (#90). « seance » : elle seule change (le cours reste) ;
 * « suivantes » : le cours prend le nouveau créneau à partir de cette séance,
 * les séances précédentes gardent leur heure (figée), les suivantes passent
 * au nouveau jour en gardant leur intervenant (remplacement). L'appelant
 * resynchronise ensuite les séances à partir de `depuis`.
 */
export async function deplacerSeance(
  tx: Tx,
  id: string,
  creneau: z.input<typeof creneauSeanceValide>,
  portee: "seance" | "suivantes",
): Promise<ResultatSeance> {
  const c = creneauSeanceValide.safeParse(creneau);
  if (!c.success) return { statut: "refus", message: c.error.issues[0].message };
  const { date, heureDebut, dureeMinutes } = c.data;
  if (Number(heureDebut.slice(0, 2)) * 60 + Number(heureDebut.slice(3)) + dureeMinutes > 24 * 60) {
    return { statut: "refus", message: "La séance finirait après minuit." };
  }
  if (!estUuid(id)) return { statut: "refus", message: "Cette séance n’existe plus." };
  const [s] = await tx
    .select({
      coursId: lesson.courseId,
      date: lesson.date,
      datePrevue: lesson.plannedDate,
      statut: lesson.status,
      appel: sql<boolean>`${avecAppel}`,
      saisonId: course.seasonId,
      recurrence: course.recurrence,
      jourCours: course.weekday,
      heureCours: sql<string>`to_char(${course.startTime}, 'HH24:MI')`,
      dureeCours: course.durationMinutes,
      saisonDebut: season.startDate,
      saisonFin: season.endDate,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(season, eq(season.id, course.seasonId))
    .where(eq(lesson.id, id));
  if (!s) return { statut: "refus", message: "Cette séance n’existe plus." };
  if (s.statut !== "prevue" || s.appel)
    return { statut: "refus", message: "Cette séance est annulée ou son appel est fait : elle ne se déplace plus." };
  if (date < s.saisonDebut || date > s.saisonFin)
    return { statut: "refus", message: "Cette date est en dehors de la saison." };
  const repere = s.datePrevue ?? s.date;

  if (portee === "seance") {
    if (date !== s.date) {
      const [autre] = await tx
        .select({ id: lesson.id })
        .from(lesson)
        .where(and(eq(lesson.courseId, s.coursId), eq(lesson.date, date)));
      if (autre) return { statut: "refus", message: "Ce cours a déjà une séance ce jour-là." };
    }
    const memeCreneau = heureDebut === s.heureCours && dureeMinutes === s.dureeCours;
    if (s.recurrence === "dates") {
      // Cours ponctuel : la date fait partie du cours lui-même.
      if (date !== s.date) {
        await tx.delete(courseDate).where(and(eq(courseDate.courseId, s.coursId), eq(courseDate.date, s.date)));
        await tx
          .insert(courseDate)
          .values({ schoolId: ECOLE_COURANTE, courseId: s.coursId, date })
          .onConflictDoNothing();
      }
      await tx
        .update(lesson)
        .set({ date, startTime: memeCreneau ? null : heureDebut, durationMinutes: memeCreneau ? null : dureeMinutes })
        .where(eq(lesson.id, id));
    } else {
      await tx
        .update(lesson)
        .set({
          date,
          // Revenue à son créneau d'origine : plus déplacée.
          plannedDate: date === repere && memeCreneau ? null : repere,
          startTime: memeCreneau ? null : heureDebut,
          durationMinutes: memeCreneau ? null : dureeMinutes,
        })
        .where(eq(lesson.id, id));
    }
    return { statut: "ok", saisonId: s.saisonId, depuis: null };
  }

  if (s.recurrence === "dates")
    return { statut: "refus", message: "Un cours à dates précises se déplace séance par séance." };
  const nouveauJour = jourIso(date);
  // 1. Les séances d'avant gardent l'ancien créneau.
  await tx
    .update(lesson)
    .set({
      startTime: sql`coalesce(${lesson.startTime}, ${s.heureCours}::time)`,
      durationMinutes: sql`coalesce(${lesson.durationMinutes}, ${s.dureeCours})`,
    })
    .where(and(eq(lesson.courseId, s.coursId), sql`coalesce(${lesson.plannedDate}, ${lesson.date}) < ${repere}::date`));
  // 2. Le cours prend le nouveau créneau.
  await tx
    .update(course)
    .set({ weekday: nouveauJour, startTime: heureDebut, durationMinutes: dureeMinutes })
    .where(eq(course.id, s.coursId));
  // 3. Les séances suivantes encore modifiables passent au nouveau jour de leur semaine, sans heure propre.
  const suivantes = await tx
    .select({ id: lesson.id, repere: sql<string>`coalesce(${lesson.plannedDate}, ${lesson.date})::text` })
    .from(lesson)
    .where(
      and(
        eq(lesson.courseId, s.coursId),
        eq(lesson.status, "prevue"),
        sql`coalesce(${lesson.plannedDate}, ${lesson.date}) >= ${repere}::date`,
        sql`NOT ${avecAppel}`,
      ),
    );
  for (const x of suivantes) {
    await tx
      .update(lesson)
      .set({
        date: decaler(x.repere, nouveauJour - jourIso(x.repere)),
        plannedDate: null,
        startTime: null,
        durationMinutes: null,
      })
      .where(eq(lesson.id, x.id));
  }
  return { statut: "ok", saisonId: s.saisonId, depuis: decaler(repere, 1 - jourIso(repere)) };
}
