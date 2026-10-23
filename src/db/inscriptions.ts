import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { calculerTarif } from "../domaine/tarif/calculer";
import type {
  CoursChoisi,
  DemandeInscription,
  LigneTarif,
  Periodicite,
  Public,
  RegleReduction,
  ResultatInscription,
} from "../domaine/tarif/types";
import type { Tx } from "./index";
import { danseursPayables } from "./personnes";
import { course, discipline, enrollment, enrollmentCourse, person, discount, tariff } from "./schema";

/**
 * Inscriptions : chargement des données de l'école, validation de la saisie,
 * calcul par le moteur de tarif (pur) et enregistrement. Toujours avec la
 * transaction d'`avecEcole()` : la RLS limite tout à l'école courante.
 */

export type SaisieInscription = {
  danseurIds: string[];
  public: Public;
  periodicite: Periodicite;
  coursIds: string[];
};

const NOUVELLE = "nouvelle";
const uuid = z.uuid();

export async function chargerGrille(tx: Tx, saisonId: string): Promise<LigneTarif[]> {
  return tx
    .select({
      id: tariff.id,
      public: tariff.audience,
      periodicite: tariff.period,
      combinaison: tariff.combination,
      disciplineId: tariff.disciplineId,
      prixCentimes: tariff.priceCents,
    })
    .from(tariff)
    .where(eq(tariff.seasonId, saisonId));
}

export async function chargerReductions(tx: Tx, saisonId: string): Promise<RegleReduction[]> {
  return tx
    .select({
      code: discount.code,
      tauxPointsBase: discount.rateBps,
      montantCentimes: discount.amountCents,
      seuilDanseurs: discount.minStudents,
      publics: discount.audiences,
      cumulableMultiDisciplines: discount.combinableWithMultiDiscipline,
    })
    .from(discount)
    .where(eq(discount.seasonId, saisonId));
}

type Existante = DemandeInscription & { remiseEnregistree: number };

/** Inscriptions actives du payeur pour la saison, sous la forme attendue par le moteur. */
async function inscriptionsExistantes(tx: Tx, payeurId: string, saisonId: string): Promise<Existante[]> {
  const lignes = await tx
    .select({
      id: enrollment.id,
      public: enrollment.audience,
      periodicite: enrollment.period,
      remise: enrollment.discountCents,
    })
    .from(enrollment)
    .where(and(eq(enrollment.payerId, payeurId), eq(enrollment.seasonId, saisonId), eq(enrollment.status, "active")));
  if (lignes.length === 0) return [];

  const liens = await tx
    .select({
      inscriptionId: enrollmentCourse.enrollmentId,
      danseurId: enrollmentCourse.studentId,
      coursId: enrollmentCourse.courseId,
      disciplineId: course.disciplineId,
      dureeMinutes: course.durationMinutes,
    })
    .from(enrollmentCourse)
    .innerJoin(course, eq(course.id, enrollmentCourse.courseId))
    .where(
      inArray(
        enrollmentCourse.enrollmentId,
        lignes.map((l) => l.id),
      ),
    );

  return lignes.map((l) => {
    const siens = liens.filter((x) => x.inscriptionId === l.id);
    const coursUniques = new Map(
      siens.map((x) => [x.coursId, { disciplineId: x.disciplineId, dureeMinutes: x.dureeMinutes }]),
    );
    return {
      reference: l.id,
      danseurIds: [...new Set(siens.map((x) => x.danseurId))],
      public: l.public,
      periodicite: l.periodicite,
      cours: [...coursUniques.values()],
      remiseEnregistree: l.remise,
    };
  });
}

/** Danseurs du payeur et cours de la saison réellement choisis ; sinon le motif du refus. */
async function valider(
  tx: Tx,
  payeurId: string,
  saisonId: string,
  saisie: SaisieInscription,
): Promise<string | CoursChoisi[]> {
  const danseurIds = [...new Set(saisie.danseurIds)];
  const coursIds = [...new Set(saisie.coursIds)];
  if (saisie.public === "couple" && danseurIds.length !== 2) return "Un couple réunit deux danseurs.";
  if (saisie.public !== "couple" && danseurIds.length !== 1)
    return "Une inscription individuelle concerne un seul danseur.";
  if (![...danseurIds, ...coursIds].every((id) => uuid.safeParse(id).success)) return "Saisie invalide.";

  const payables = new Set((await danseursPayables(tx, payeurId)).map((d) => d.id));
  if (!danseurIds.every((id) => payables.has(id)))
    return "Cette personne ne paie pas pour ce danseur : ajoutez le lien « paie pour » sur sa fiche.";

  if (coursIds.length === 0) return [];
  const choisis = await tx
    .select({ disciplineId: course.disciplineId, dureeMinutes: course.durationMinutes })
    .from(course)
    .where(and(inArray(course.id, coursIds), eq(course.seasonId, saisonId)));
  if (choisis.length !== coursIds.length) return "Un des cours ne fait pas partie de la saison.";
  return choisis;
}

/** Une inscription déjà enregistrée dont la remise changerait avec la nouvelle (ex. fratrie). */
export type ImpactExistante = {
  reference: string;
  danseurs: string;
  remiseEnregistree: number;
  remiseRecalculee: number;
};

export type Apercu =
  { statut: "invalide"; message: string } | { statut: "ok"; nouvelle: ResultatInscription; autres: ImpactExistante[] };

/** Prix de la nouvelle inscription, calculé avec la grille, les réductions et les autres inscriptions du payeur. */
export async function apercuInscription(
  tx: Tx,
  payeurId: string,
  saisonId: string,
  saisie: SaisieInscription,
): Promise<Apercu> {
  const coursChoisis = await valider(tx, payeurId, saisonId, saisie);
  if (typeof coursChoisis === "string") return { statut: "invalide", message: coursChoisis };

  const grille = await chargerGrille(tx, saisonId);
  const reductions = await chargerReductions(tx, saisonId);
  const existantes = await inscriptionsExistantes(tx, payeurId, saisonId);
  const resultat = calculerTarif({
    grille,
    reductions,
    inscriptions: [
      ...existantes,
      {
        reference: NOUVELLE,
        danseurIds: saisie.danseurIds,
        public: saisie.public,
        periodicite: saisie.periodicite,
        cours: coursChoisis,
      },
    ],
  });

  const prenoms = new Map((await danseursPayables(tx, payeurId)).map((d) => [d.id, d.prenom]));
  const autres = existantes.flatMap((e): ImpactExistante[] => {
    const r = resultat.inscriptions.find((i) => i.reference === e.reference);
    const remiseRecalculee = r?.statut === "ok" ? r.remiseCentimes : e.remiseEnregistree;
    if (remiseRecalculee === e.remiseEnregistree) return [];
    const danseurs = e.danseurIds.map((id) => prenoms.get(id) ?? "?").join(" et ");
    return [{ reference: e.reference, danseurs, remiseEnregistree: e.remiseEnregistree, remiseRecalculee }];
  });

  return { statut: "ok", nouvelle: resultat.inscriptions.find((i) => i.reference === NOUVELLE)!, autres };
}

/** Enregistre l'inscription au prix recalculé ici (jamais celui envoyé par le navigateur). */
export async function enregistrerInscription(
  tx: Tx,
  payeurId: string,
  saisonId: string,
  saisie: SaisieInscription,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const apercu = await apercuInscription(tx, payeurId, saisonId, saisie);
  if (apercu.statut === "invalide") return { ok: false, message: apercu.message };
  const r = apercu.nouvelle;
  if (r.statut === "erreur") return { ok: false, message: r.erreur.message };

  const [{ id }] = await tx
    .insert(enrollment)
    .values({
      schoolId: sql`nullif(current_setting('app.school_id', true), '')::uuid`,
      payerId: payeurId,
      seasonId: saisonId,
      tariffId: r.ligneTarifId,
      audience: saisie.public,
      period: saisie.periodicite,
      grossPriceCents: r.prixBrutCentimes,
      discountCents: r.remiseCentimes,
      discounts: r.reductions.filter((d) => d.statut === "appliquee").map((d) => d.code),
    })
    .returning({ id: enrollment.id });

  const danseurIds = [...new Set(saisie.danseurIds)];
  const coursIds = [...new Set(saisie.coursIds)];
  if (coursIds.length > 0) {
    await tx.insert(enrollmentCourse).values(
      danseurIds.flatMap((danseurId) =>
        coursIds.map((coursId) => ({
          schoolId: sql`nullif(current_setting('app.school_id', true), '')::uuid`,
          enrollmentId: id,
          studentId: danseurId,
          courseId: coursId,
        })),
      ),
    );
  }
  return { ok: true, id };
}

export type InscriptionPayee = {
  id: string;
  danseurs: string;
  public: Public;
  periodicite: Periodicite;
  cours: string[];
  prixNetCentimes: number;
};

/** Inscriptions actives payées par une personne pour la saison, triées par danseur. */
export async function inscriptionsPayeesPar(tx: Tx, payeurId: string, saisonId: string): Promise<InscriptionPayee[]> {
  const lignes = await tx
    .select({
      id: enrollment.id,
      public: enrollment.audience,
      periodicite: enrollment.period,
      prixNetCentimes: enrollment.netPriceCents,
    })
    .from(enrollment)
    .where(and(eq(enrollment.payerId, payeurId), eq(enrollment.seasonId, saisonId), eq(enrollment.status, "active")));
  if (lignes.length === 0) return [];

  const liens = await tx
    .select({
      inscriptionId: enrollmentCourse.enrollmentId,
      prenom: sql<string>`coalesce(${person.firstName}, ${person.lastName})`,
      discipline: discipline.name,
      jour: course.weekday,
      heure: course.startTime,
    })
    .from(enrollmentCourse)
    .innerJoin(person, eq(person.id, enrollmentCourse.studentId))
    .innerJoin(course, eq(course.id, enrollmentCourse.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .where(
      inArray(
        enrollmentCourse.enrollmentId,
        lignes.map((l) => l.id),
      ),
    )
    .orderBy(asc(course.weekday), asc(course.startTime));

  const JOURS = ["", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
  return lignes
    .map((l) => {
      const siens = liens.filter((x) => x.inscriptionId === l.id);
      return {
        id: l.id,
        public: l.public,
        periodicite: l.periodicite,
        prixNetCentimes: l.prixNetCentimes ?? 0,
        danseurs: [...new Set(siens.map((x) => x.prenom))].sort().join(" et "),
        cours: [
          ...new Set(
            siens.map((x) =>
              `${x.discipline} ${x.jour ? JOURS[x.jour] : ""} ${x.heure.slice(0, 5)}`.replace("  ", " "),
            ),
          ),
        ],
      };
    })
    .sort((a, b) => a.danseurs.localeCompare(b.danseurs, "fr"));
}
