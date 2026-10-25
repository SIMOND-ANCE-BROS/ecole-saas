import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { discipline, enrollment, discount, tariff, lessonPackTariff } from "./schema";

/**
 * Tariff grid, discounts and lesson packs of a season (#80). They are the
 * school's data: the tariff engine receives them as they are. Always
 * within the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
export type Result = { ok: true; id: string } | { ok: false; message: string };

export const AUDIENCES = ["child", "adult", "couple", "student"] as const;
export const PERIODS = ["quarter", "year", "single"] as const;
export type Audience = (typeof AUDIENCES)[number];
export type Period = (typeof PERIODS)[number];

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export type GridRow = {
  audience: Audience;
  /** Sorted durations, in minutes. */
  combination: number[];
  disciplineId: string | null;
  discipline: string | null;
  /** Price per periodicity (missing: no package for that periodicity). */
  price: Partial<Record<Period, { id: string; cents: number; used: boolean }>>;
};

/** Rows of a season's grid, grouped by audience, combination and discipline; shortest to longest. */
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
  /** null: remove the price of this cell. */
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
 * Sets (or removes) the price of a grid cell. The price of a cell already
 * in use can change (enrollments keep theirs); it cannot be
 * removed.
 */
export async function savePrice(tx: Tx, seasonId: string, entry: z.input<typeof validCell>): Promise<Result> {
  const c = validCell.safeParse(entry);
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
// Discounts (the engine only knows siblings)
// ---------------------------------------------------------------------------

export type Siblings = {
  rateBps: number | null;
  amountCents: number | null;
  minStudents: number;
  audiences: Audience[];
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
    audiences: z.array(z.enum(AUDIENCES)).max(AUDIENCES.length),
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

/** Siblings discount rule of the season; null deletes it. */
export async function saveSiblings(
  tx: Tx,
  seasonId: string,
  entry: z.input<typeof validSiblings> | null,
): Promise<Result> {
  if (!isUuid(seasonId)) return { ok: false, message: "Saison introuvable." };
  if (entry === null) {
    await tx.delete(discount).where(and(eq(discount.seasonId, seasonId), eq(discount.code, "fratrie")));
    return { ok: true, id: seasonId };
  }
  const f = validSiblings.safeParse(entry);
  if (!f.success) return { ok: false, message: f.error.issues[0].message };
  await tx
    .insert(discount)
    .values({ ...siblingsRow(f.data), code: "fratrie", seasonId: seasonId, schoolId: CURRENT_SCHOOL })
    .onConflictDoUpdate({ target: [discount.seasonId, discount.code], set: siblingsRow(f.data) });
  return { ok: true, id: seasonId };
}

// ---------------------------------------------------------------------------
// Lesson packs (private lessons)
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

/** Creates or updates the price of a lesson pack (lessons, people). */
export async function saveLessonPack(
  tx: Tx,
  seasonId: string,
  entry: z.input<typeof validLessonPack>,
): Promise<Result> {
  const c = validLessonPack.safeParse(entry);
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
