import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { discipline, enrollment, discount, tariff, lessonPackTariff } from "./schema";

/**
 * Grille tarifaire, réductions et carnets d'une saison (#80). Ce sont des
 * données de l'école : le moteur de tarif les reçoit telles quelles. Toujours
 * avec la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
export type Resultat = { ok: true; id: string } | { ok: false; message: string };

export const PUBLICS = ["enfant", "adulte", "couple", "etudiant"] as const;
export const PERIODICITES = ["trimestre", "annee", "unite"] as const;
export type Public = (typeof PUBLICS)[number];
export type Periodicite = (typeof PERIODICITES)[number];

// ---------------------------------------------------------------------------
// Grille
// ---------------------------------------------------------------------------

export type LigneGrille = {
  public: Public;
  /** Durées triées, en minutes. */
  combinaison: number[];
  disciplineId: string | null;
  discipline: string | null;
  /** Prix par périodicité (absent : pas de forfait pour cette périodicité). */
  prix: Partial<Record<Periodicite, { id: string; centimes: number; utilise: boolean }>>;
};

/** Lignes de la grille d'une saison, regroupées par public, combinaison et discipline ; des plus courtes aux plus longues. */
export async function grilleSaison(tx: Tx, saisonId: string): Promise<LigneGrille[]> {
  if (!estUuid(saisonId)) return [];
  const idTarif = sql`${tariff}.${sql.identifier("id")}`;
  const cases = await tx
    .select({
      id: tariff.id,
      public: tariff.audience,
      periodicite: tariff.period,
      combinaison: tariff.combination,
      disciplineId: tariff.disciplineId,
      discipline: discipline.name,
      prixCentimes: tariff.priceCents,
      utilise: sql<boolean>`EXISTS (SELECT 1 FROM enrollment i WHERE i.tariff_id = ${idTarif})`,
    })
    .from(tariff)
    .leftJoin(discipline, eq(discipline.id, tariff.disciplineId))
    .where(eq(tariff.seasonId, saisonId));

  const lignes = new Map<string, LigneGrille>();
  for (const c of cases) {
    const combinaison = [...c.combinaison].sort((a, b) => a - b);
    const cle = `${c.public}|${combinaison.join("+")}|${c.disciplineId ?? ""}`;
    const ligne = lignes.get(cle) ?? {
      public: c.public,
      combinaison,
      disciplineId: c.disciplineId,
      discipline: c.discipline,
      prix: {},
    };
    ligne.prix[c.periodicite] = { id: c.id, centimes: c.prixCentimes, utilise: c.utilise };
    lignes.set(cle, ligne);
  }
  const total = (l: LigneGrille) => l.combinaison.reduce((s, d) => s + d, 0);
  return [...lignes.values()].sort(
    (a, b) =>
      PUBLICS.indexOf(a.public) - PUBLICS.indexOf(b.public) ||
      Number(a.disciplineId !== null) - Number(b.disciplineId !== null) ||
      a.combinaison.length - b.combinaison.length ||
      total(a) - total(b) ||
      a.combinaison.join("+").localeCompare(b.combinaison.join("+")) ||
      (a.discipline ?? "").localeCompare(b.discipline ?? ""),
  );
}

export const caseValide = z.object({
  public: z.enum(PUBLICS),
  combinaison: z.array(z.int().min(5).max(600)).min(1, "Indiquez au moins un cours").max(6),
  disciplineId: z.uuid().nullable(),
  periodicite: z.enum(PERIODICITES),
  /** null : retirer le prix de cette case. */
  prixCentimes: z.int().min(0).max(10_000_00).nullable(),
});

const memeCase = (saisonId: string, c: z.output<typeof caseValide>, combinaison: number[]) =>
  and(
    eq(tariff.seasonId, saisonId),
    eq(tariff.audience, c.public),
    eq(tariff.period, c.periodicite),
    sql`${tariff.combination} = ${`{${combinaison.join(",")}}`}::smallint[]`,
    c.disciplineId ? eq(tariff.disciplineId, c.disciplineId) : isNull(tariff.disciplineId),
  );

/**
 * Fixe (ou retire) le prix d'une case de la grille. Le prix d'une case déjà
 * utilisée peut changer (les inscriptions gardent le leur) ; elle ne peut pas
 * être retirée.
 */
export async function enregistrerPrix(tx: Tx, saisonId: string, saisie: z.input<typeof caseValide>): Promise<Resultat> {
  const c = caseValide.safeParse(saisie);
  if (!c.success) return { ok: false, message: c.error.issues[0].message };
  if (!estUuid(saisonId)) return { ok: false, message: "Saison introuvable." };
  const combinaison = [...c.data.combinaison].sort((a, b) => a - b);
  if (c.data.disciplineId) {
    const [d] = await tx.select({ id: discipline.id }).from(discipline).where(eq(discipline.id, c.data.disciplineId));
    if (!d) return { ok: false, message: "Discipline introuvable." };
  }
  const [existante] = await tx
    .select({ id: tariff.id })
    .from(tariff)
    .where(memeCase(saisonId, c.data, combinaison));

  if (c.data.prixCentimes === null) {
    if (!existante) return { ok: true, id: "" };
    const [utilisee] = await tx
      .select({ id: enrollment.id })
      .from(enrollment)
      .where(eq(enrollment.tariffId, existante.id))
      .limit(1);
    if (utilisee)
      return { ok: false, message: "Ce prix sert déjà à des inscriptions : modifiez-le plutôt que de le retirer." };
    await tx.delete(tariff).where(eq(tariff.id, existante.id));
    return { ok: true, id: existante.id };
  }
  if (existante) {
    await tx.update(tariff).set({ priceCents: c.data.prixCentimes }).where(eq(tariff.id, existante.id));
    return { ok: true, id: existante.id };
  }
  const [{ id }] = await tx
    .insert(tariff)
    .values({
      schoolId: ECOLE_COURANTE,
      seasonId: saisonId,
      audience: c.data.public,
      period: c.data.periodicite,
      combination: combinaison,
      disciplineId: c.data.disciplineId,
      priceCents: c.data.prixCentimes,
    })
    .returning({ id: tariff.id });
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Réductions (le moteur ne connaît que la fratrie)
// ---------------------------------------------------------------------------

export type Fratrie = {
  tauxPointsBase: number | null;
  montantCentimes: number | null;
  seuilDanseurs: number;
  publics: Public[];
  cumulableMultiDisciplines: boolean;
};

export async function lireFratrie(tx: Tx, saisonId: string): Promise<Fratrie | null> {
  if (!estUuid(saisonId)) return null;
  const [r] = await tx
    .select({
      tauxPointsBase: discount.rateBps,
      montantCentimes: discount.amountCents,
      seuilDanseurs: discount.minStudents,
      publics: discount.audiences,
      cumulableMultiDisciplines: discount.combinableWithMultiDiscipline,
    })
    .from(discount)
    .where(and(eq(discount.seasonId, saisonId), eq(discount.code, "fratrie")));
  return r ?? null;
}

export const fratrieValide = z
  .object({
    tauxPointsBase: z.int().min(1).max(10000).nullable(),
    montantCentimes: z.int().min(1).max(10_000_00).nullable(),
    seuilDanseurs: z.int().min(2).max(10),
    publics: z.array(z.enum(PUBLICS)),
    cumulableMultiDisciplines: z.boolean(),
  })
  .refine(
    (f) => (f.tauxPointsBase === null) !== (f.montantCentimes === null),
    "Indiquez un pourcentage ou un montant, pas les deux.",
  );

/** Siblings discount columns from the form input. */
const ligneFratrie = (f: z.output<typeof fratrieValide>) => ({
  rateBps: f.tauxPointsBase,
  amountCents: f.montantCentimes,
  minStudents: f.seuilDanseurs,
  audiences: f.publics,
  combinableWithMultiDiscipline: f.cumulableMultiDisciplines,
});

/** Règle de la réduction fratrie de la saison ; null la supprime. */
export async function enregistrerFratrie(
  tx: Tx,
  saisonId: string,
  saisie: z.input<typeof fratrieValide> | null,
): Promise<Resultat> {
  if (!estUuid(saisonId)) return { ok: false, message: "Saison introuvable." };
  if (saisie === null) {
    await tx.delete(discount).where(and(eq(discount.seasonId, saisonId), eq(discount.code, "fratrie")));
    return { ok: true, id: saisonId };
  }
  const f = fratrieValide.safeParse(saisie);
  if (!f.success) return { ok: false, message: f.error.issues[0].message };
  await tx
    .insert(discount)
    .values({ ...ligneFratrie(f.data), code: "fratrie", seasonId: saisonId, schoolId: ECOLE_COURANTE })
    .onConflictDoUpdate({ target: [discount.seasonId, discount.code], set: ligneFratrie(f.data) });
  return { ok: true, id: saisonId };
}

// ---------------------------------------------------------------------------
// Carnets (cours particuliers)
// ---------------------------------------------------------------------------

export type LigneCarnet = { id: string; nbSeances: number; personnesMax: number; prixCentimes: number };

export function listerCarnets(tx: Tx, saisonId: string): Promise<LigneCarnet[]> {
  if (!estUuid(saisonId)) return Promise.resolve([]);
  return tx
    .select({
      id: lessonPackTariff.id,
      nbSeances: lessonPackTariff.lessonCount,
      personnesMax: lessonPackTariff.maxPeople,
      prixCentimes: lessonPackTariff.priceCents,
    })
    .from(lessonPackTariff)
    .where(eq(lessonPackTariff.seasonId, saisonId))
    .orderBy(asc(lessonPackTariff.maxPeople), asc(lessonPackTariff.lessonCount));
}

export const carnetValide = z.object({
  nbSeances: z.int().min(1).max(100),
  personnesMax: z.int().min(1).max(20),
  prixCentimes: z.int().min(0).max(10_000_00),
});

/** Crée ou met à jour le prix d'un carnet (séances, personnes). */
export async function enregistrerCarnet(
  tx: Tx,
  saisonId: string,
  saisie: z.input<typeof carnetValide>,
): Promise<Resultat> {
  const c = carnetValide.safeParse(saisie);
  if (!c.success) return { ok: false, message: c.error.issues[0].message };
  if (!estUuid(saisonId)) return { ok: false, message: "Saison introuvable." };
  const [{ id }] = await tx
    .insert(lessonPackTariff)
    .values({
      lessonCount: c.data.nbSeances,
      maxPeople: c.data.personnesMax,
      priceCents: c.data.prixCentimes,
      seasonId: saisonId,
      schoolId: ECOLE_COURANTE,
    })
    .onConflictDoUpdate({
      target: [lessonPackTariff.seasonId, lessonPackTariff.lessonCount, lessonPackTariff.maxPeople],
      set: { priceCents: c.data.prixCentimes },
    })
    .returning({ id: lessonPackTariff.id });
  return { ok: true, id };
}

export async function supprimerCarnet(tx: Tx, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Ce carnet n’existe plus." };
  const lignes = await tx
    .delete(lessonPackTariff)
    .where(eq(lessonPackTariff.id, id))
    .returning({ id: lessonPackTariff.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Ce carnet n’existe plus." };
}
