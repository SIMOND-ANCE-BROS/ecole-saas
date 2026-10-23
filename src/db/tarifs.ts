import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { discipline, enrollment, discount, tariff, lessonPackTariff } from "./schema";

/**
 * Grille tarifaire, réductions et carnets d'une saison (#80). Ce sont des
 * données de l'école : le moteur de tarif les reçoit telles quelles. Toujours
 * avec la transaction d'`avecEcole()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
export type Result = { ok: true; id: string } | { ok: false; message: string };

export const AUDIENCES = ["enfant", "adulte", "couple", "etudiant"] as const;
export const PERIODS = ["trimestre", "annee", "unite"] as const;
export type Public = (typeof AUDIENCES)[number];
export type Period = (typeof PERIODS)[number];

// ---------------------------------------------------------------------------
// Grille
// ---------------------------------------------------------------------------

export type GridRow = {
  audience: Public;
  /** Durées triées, en minutes. */
  combination: number[];
  disciplineId: string | null;
  discipline: string | null;
  /** Prix par périodicité (absent : pas de forfait pour cette périodicité). */
  price: Partial<Record<Period, { id: string; cents: number; used: boolean }>>;
};

/** Lignes de la grille d'une saison, regroupées par public, combinaison et discipline ; des plus courtes aux plus longues. */
export async function seasonGrid(tx: Tx, seasonId: string): Promise<GridRow[]> {
  if (!isUuid(seasonId)) return [];
  const tariffId = sql`${tariff}.${sql.identifier("id")}`;
  const cells = await tx
    .select({
      id: tariff.id,
      audience: tariff.audience,
      period: tariff.period,
      combination: tariff.combination,
      disciplineId: tariff.disciplineId,
      discipline: discipline.name,
      priceCents: tariff.priceCents,
      used: sql<boolean>`EXISTS (SELECT 1 FROM enrollment i WHERE i.tariff_id = ${tariffId})`,
    })
    .from(tariff)
    .leftJoin(discipline, eq(discipline.id, tariff.disciplineId))
    .where(eq(tariff.seasonId, seasonId));

  const rows = new Map<string, GridRow>();
  for (const c of cells) {
    const combination = [...c.combination].sort((a, b) => a - b);
    const key = `${c.audience}|${combination.join("+")}|${c.disciplineId ?? ""}`;
    const row = rows.get(key) ?? {
      audience: c.audience,
      combination,
      disciplineId: c.disciplineId,
      discipline: c.discipline,
      price: {},
    };
    row.price[c.period] = { id: c.id, cents: c.priceCents, used: c.used };
    rows.set(key, row);
  }
  const total = (l: GridRow) => l.combination.reduce((s, d) => s + d, 0);
  return [...rows.values()].sort(
    (a, b) =>
      AUDIENCES.indexOf(a.audience) - AUDIENCES.indexOf(b.audience) ||
      Number(a.disciplineId !== null) - Number(b.disciplineId !== null) ||
      a.combination.length - b.combination.length ||
      total(a) - total(b) ||
      a.combination.join("+").localeCompare(b.combination.join("+")) ||
      (a.discipline ?? "").localeCompare(b.discipline ?? ""),
  );
}

export const validCell = z.object({
  audience: z.enum(AUDIENCES),
  combination: z.array(z.int().min(5).max(600)).min(1, "Indiquez au moins un cours").max(6),
  disciplineId: z.uuid().nullable(),
  period: z.enum(PERIODS),
  /** null : retirer le prix de cette case. */
  priceCents: z.int().min(0).max(10_000_00).nullable(),
});

const sameCase = (seasonId: string, c: z.output<typeof validCell>, combination: number[]) =>
  and(
    eq(tariff.seasonId, seasonId),
    eq(tariff.audience, c.audience),
    eq(tariff.period, c.period),
    sql`${tariff.combination} = ${`{${combination.join(",")}}`}::smallint[]`,
    c.disciplineId ? eq(tariff.disciplineId, c.disciplineId) : isNull(tariff.disciplineId),
  );

/**
 * Fixe (ou retire) le prix d'une case de la grille. Le prix d'une case déjà
 * utilisée peut changer (les inscriptions gardent le leur) ; elle ne peut pas
 * être retirée.
 */
export async function savePrice(tx: Tx, seasonId: string, saisie: z.input<typeof validCell>): Promise<Result> {
  const c = validCell.safeParse(saisie);
  if (!c.success) return { ok: false, message: c.error.issues[0].message };
  if (!isUuid(seasonId)) return { ok: false, message: "Saison introuvable." };
  const combination = [...c.data.combination].sort((a, b) => a - b);
  if (c.data.disciplineId) {
    const [d] = await tx.select({ id: discipline.id }).from(discipline).where(eq(discipline.id, c.data.disciplineId));
    if (!d) return { ok: false, message: "Discipline introuvable." };
  }
  const [existing] = await tx
    .select({ id: tariff.id })
    .from(tariff)
    .where(sameCase(seasonId, c.data, combination));

  if (c.data.priceCents === null) {
    if (!existing) return { ok: true, id: "" };
    const [used] = await tx
      .select({ id: enrollment.id })
      .from(enrollment)
      .where(eq(enrollment.tariffId, existing.id))
      .limit(1);
    if (used)
      return { ok: false, message: "Ce prix sert déjà à des inscriptions : modifiez-le plutôt que de le retirer." };
    await tx.delete(tariff).where(eq(tariff.id, existing.id));
    return { ok: true, id: existing.id };
  }
  if (existing) {
    await tx.update(tariff).set({ priceCents: c.data.priceCents }).where(eq(tariff.id, existing.id));
    return { ok: true, id: existing.id };
  }
  const [{ id }] = await tx
    .insert(tariff)
    .values({
      schoolId: CURRENT_SCHOOL,
      seasonId: seasonId,
      audience: c.data.audience,
      period: c.data.period,
      combination: combination,
      disciplineId: c.data.disciplineId,
      priceCents: c.data.priceCents,
    })
    .returning({ id: tariff.id });
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Réductions (le moteur ne connaît que la fratrie)
// ---------------------------------------------------------------------------

export type Siblings = {
  rateBps: number | null;
  amountCents: number | null;
  minStudents: number;
  audiences: Public[];
  combinableWithMultiDiscipline: boolean;
};

export async function readSiblings(tx: Tx, seasonId: string): Promise<Siblings | null> {
  if (!isUuid(seasonId)) return null;
  const [r] = await tx
    .select({
      rateBps: discount.rateBps,
      amountCents: discount.amountCents,
      minStudents: discount.minStudents,
      audiences: discount.audiences,
      combinableWithMultiDiscipline: discount.combinableWithMultiDiscipline,
    })
    .from(discount)
    .where(and(eq(discount.seasonId, seasonId), eq(discount.code, "fratrie")));
  return r ?? null;
}

export const validSiblings = z
  .object({
    rateBps: z.int().min(1).max(10000).nullable(),
    amountCents: z.int().min(1).max(10_000_00).nullable(),
    minStudents: z.int().min(2).max(10),
    audiences: z.array(z.enum(AUDIENCES)),
    combinableWithMultiDiscipline: z.boolean(),
  })
  .refine(
    (f) => (f.rateBps === null) !== (f.amountCents === null),
    "Indiquez un pourcentage ou un montant, pas les deux.",
  );

/** Siblings discount columns from the form input. */
const siblingsRow = (f: z.output<typeof validSiblings>) => ({
  rateBps: f.rateBps,
  amountCents: f.amountCents,
  minStudents: f.minStudents,
  audiences: f.audiences,
  combinableWithMultiDiscipline: f.combinableWithMultiDiscipline,
});

/** Règle de la réduction fratrie de la saison ; null la supprime. */
export async function saveSiblings(
  tx: Tx,
  seasonId: string,
  saisie: z.input<typeof validSiblings> | null,
): Promise<Result> {
  if (!isUuid(seasonId)) return { ok: false, message: "Saison introuvable." };
  if (saisie === null) {
    await tx.delete(discount).where(and(eq(discount.seasonId, seasonId), eq(discount.code, "fratrie")));
    return { ok: true, id: seasonId };
  }
  const f = validSiblings.safeParse(saisie);
  if (!f.success) return { ok: false, message: f.error.issues[0].message };
  await tx
    .insert(discount)
    .values({ ...siblingsRow(f.data), code: "fratrie", seasonId: seasonId, schoolId: CURRENT_SCHOOL })
    .onConflictDoUpdate({ target: [discount.seasonId, discount.code], set: siblingsRow(f.data) });
  return { ok: true, id: seasonId };
}

// ---------------------------------------------------------------------------
// Carnets (cours particuliers)
// ---------------------------------------------------------------------------

export type LessonPackRow = { id: string; lessonCount: number; maxPeople: number; priceCents: number };

export function listLessonPacks(tx: Tx, seasonId: string): Promise<LessonPackRow[]> {
  if (!isUuid(seasonId)) return Promise.resolve([]);
  return tx
    .select({
      id: lessonPackTariff.id,
      lessonCount: lessonPackTariff.lessonCount,
      maxPeople: lessonPackTariff.maxPeople,
      priceCents: lessonPackTariff.priceCents,
    })
    .from(lessonPackTariff)
    .where(eq(lessonPackTariff.seasonId, seasonId))
    .orderBy(asc(lessonPackTariff.maxPeople), asc(lessonPackTariff.lessonCount));
}

export const validLessonPack = z.object({
  lessonCount: z.int().min(1).max(100),
  maxPeople: z.int().min(1).max(20),
  priceCents: z.int().min(0).max(10_000_00),
});

/** Crée ou met à jour le prix d'un carnet (séances, personnes). */
export async function saveLessonPack(
  tx: Tx,
  seasonId: string,
  saisie: z.input<typeof validLessonPack>,
): Promise<Result> {
  const c = validLessonPack.safeParse(saisie);
  if (!c.success) return { ok: false, message: c.error.issues[0].message };
  if (!isUuid(seasonId)) return { ok: false, message: "Saison introuvable." };
  const [{ id }] = await tx
    .insert(lessonPackTariff)
    .values({
      lessonCount: c.data.lessonCount,
      maxPeople: c.data.maxPeople,
      priceCents: c.data.priceCents,
      seasonId: seasonId,
      schoolId: CURRENT_SCHOOL,
    })
    .onConflictDoUpdate({
      target: [lessonPackTariff.seasonId, lessonPackTariff.lessonCount, lessonPackTariff.maxPeople],
      set: { priceCents: c.data.priceCents },
    })
    .returning({ id: lessonPackTariff.id });
  return { ok: true, id };
}

export async function deleteLessonPack(tx: Tx, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Ce carnet n’existe plus." };
  const rows = await tx
    .delete(lessonPackTariff)
    .where(eq(lessonPackTariff.id, id))
    .returning({ id: lessonPackTariff.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Ce carnet n’existe plus." };
}
