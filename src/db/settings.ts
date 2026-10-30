import { and, asc, desc, eq, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import { columnsOf, rowsOf } from "./columns-of";
import { z } from "zod";
import type { Hours } from "../domain/schedule/hours";
import type { Tx } from "./index";
import {
  closure,
  course,
  discipline,
  enrollmentQuarter,
  lesson,
  siteHours,
  season,
  seasonQuarter,
  room,
  site,
} from "./schema";
import { syncLessons } from "./lessons";
import { closedCourseLabel } from "../domain/schedule/closure-scope";
import { defaultQuarters, quartersOutside, quartersRefusal, type SeasonQuarter } from "../domain/enrollment/quarters";
import { biweeklySwapped, recurrenceOf } from "../domain/schedule/lessons";
import { frenchDate } from "../lib/dates";
import { issuePath } from "../lib/form-errors";

/**
 * School settings (#80): seasons, disciplines, sites and rooms. Everything
 * specific to a school is entered here, never in code. Always within
 * the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
export type Result = { ok: true; id: string } | { ok: false; message: string };
export const validName = z
  .string({ error: "Nom obligatoire" })
  .trim()
  .min(1, "Nom obligatoire")
  .max(100, "Nom : 100 caractères au plus");
const account = (query: SQL) => sql<number>`(${query})::int`;

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export type SeasonRow = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  course: number;
  tariffs: number;
  /** Its quarters (#291), in date order. */
  quarters: SeasonQuarter[];
};

/** Quarters of these seasons (#291), in date order. */
export async function seasonQuarters(tx: Tx, seasonIds: string[]): Promise<(SeasonQuarter & { seasonId: string })[]> {
  const valid = seasonIds.filter(isUuid);
  if (valid.length === 0) return [];
  return tx
    .select({
      id: seasonQuarter.id,
      seasonId: seasonQuarter.seasonId,
      label: seasonQuarter.label,
      startDate: seasonQuarter.startDate,
      endDate: seasonQuarter.endDate,
    })
    .from(seasonQuarter)
    .where(inArray(seasonQuarter.seasonId, valid))
    .orderBy(asc(seasonQuarter.startDate));
}

export async function listSeasons(tx: Tx): Promise<SeasonRow[]> {
  const id = sql`${season}.${sql.identifier("id")}`;
  const rows = await tx
    .select({
      id: season.id,
      label: season.label,
      startDate: season.startDate,
      endDate: season.endDate,
      course: account(sql`SELECT count(*) FROM course c WHERE c.season_id = ${id}`),
      tariffs: account(sql`SELECT count(*) FROM tariff t WHERE t.season_id = ${id}`),
    })
    .from(season)
    .orderBy(desc(season.startDate));
  const quarters = await seasonQuarters(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    ...r,
    quarters: quarters.filter((q) => q.seasonId === r.id).map(({ seasonId: _s, ...q }) => q),
  }));
}

const seasonFields = z.object(
  {
    label: z
      .string({ error: "Libellé obligatoire" })
      .trim()
      .min(1, "Libellé obligatoire")
      .max(30, "Libellé : 30 caractères au plus"),
    startDate: z.iso.date("Date invalide"),
    endDate: z.iso.date("Date invalide"),
  },
  { error: "Saisie invalide." },
);

export const validSeasonInput = seasonFields.refine((s) => s.endDate > s.startDate, {
  path: issuePath(seasonFields, "endDate"),
  message: "La fin doit suivre le début.",
});

/** Season columns from the form input. */
const seasonRow = (s: z.output<typeof validSeasonInput>) => ({
  label: s.label,
  startDate: s.startDate,
  endDate: s.endDate,
});

async function checkSeason(tx: Tx, s: z.output<typeof validSeasonInput>, except?: string): Promise<string | null> {
  const other = except ? ne(season.id, except) : undefined;
  const [duplicate] = await tx
    .select({ id: season.id })
    .from(season)
    .where(and(eq(season.label, s.label), other));
  if (duplicate) return "Une saison porte déjà ce libellé.";
  const [overlaps] = await tx
    .select({ label: season.label })
    .from(season)
    .where(and(sql`${season.startDate} <= ${s.endDate}`, sql`${season.endDate} >= ${s.startDate}`, other));
  return overlaps ? `Ces dates chevauchent la saison ${overlaps.label}.` : null;
}

/**
 * Creates a season with its default quarters (#291, `defaultQuarters`, to be edited after);
 * with `copyFrom`, copies that season's tariff grid, discounts and lesson packs (prices still
 * to be reviewed).
 */
export async function createSeason(
  tx: Tx,
  entry: z.input<typeof validSeasonInput>,
  copyFrom: string | null,
): Promise<Result> {
  const s = validSeasonInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const refusal = await checkSeason(tx, s.data);
  if (refusal) return { ok: false, message: refusal };
  if (copyFrom) {
    const [ref] = isUuid(copyFrom)
      ? await tx.select({ id: season.id }).from(season).where(eq(season.id, copyFrom))
      : [];
    if (!ref) return { ok: false, message: "Saison de référence introuvable." };
  }

  const [{ id }] = await tx
    .insert(season)
    .values(columnsOf(season, { ...seasonRow(s.data), schoolId: CURRENT_SCHOOL }))
    .returning({ id: season.id });
  const quarters = defaultQuarters(s.data);
  if (quarters.length > 0)
    await tx.insert(seasonQuarter).values(
      rowsOf(
        seasonQuarter,
        quarters.map((q) => ({
          schoolId: CURRENT_SCHOOL,
          seasonId: id,
          label: q.label,
          startDate: q.startDate,
          endDate: q.endDate,
        })),
      ),
    );
  if (copyFrom) {
    await tx.execute(sql`
      INSERT INTO tariff (school_id, season_id, audience, period, combination, discipline_id, price_cents)
      SELECT school_id, ${id}, audience, period, combination, discipline_id, price_cents FROM tariff WHERE season_id = ${copyFrom}`);
    await tx.execute(sql`
      INSERT INTO discount (school_id, season_id, code, rate_bps, amount_cents, not_combinable_with, min_students, audiences, combinable_with_multi_discipline)
      SELECT school_id, ${id}, code, rate_bps, amount_cents, not_combinable_with, min_students, audiences, combinable_with_multi_discipline
      FROM discount WHERE season_id = ${copyFrom}`);
    await tx.execute(sql`
      INSERT INTO lesson_pack_tariff (school_id, season_id, lesson_count, max_people, price_cents)
      SELECT school_id, ${id}, lesson_count, max_people, price_cents FROM lesson_pack_tariff WHERE season_id = ${copyFrom}`);
  }
  return { ok: true, id };
}

/**
 * New season dates must keep every closure of the season inside them (#194,
 * recommended rule pending the school's validation): the edit is refused,
 * naming the closures, rather than clipping or deleting them silently.
 */
async function closuresOutside(tx: Tx, seasonId: string, s: z.output<typeof validSeasonInput>): Promise<string | null> {
  const outside = await tx
    .select({ label: closure.label, start: closure.startDate, end: closure.endDate })
    .from(closure)
    .where(
      and(
        eq(closure.seasonId, seasonId),
        or(sql`${closure.startDate} < ${s.startDate}`, sql`${closure.endDate} > ${s.endDate}`),
      ),
    )
    .orderBy(asc(closure.startDate), asc(closure.label));
  if (outside.length === 0) return null;
  const names = outside
    .map((c) =>
      c.start === c.end
        ? `${c.label} (le ${frenchDate(c.start)})`
        : `${c.label} (du ${frenchDate(c.start)} au ${frenchDate(c.end)})`,
    )
    .join(", ");
  return outside.length === 1
    ? `Cette fermeture sortirait de la saison : ${names}. Supprimez-la dans Planning › Fermetures, puis recréez-la avec les bonnes dates.`
    : `Ces fermetures sortiraient de la saison : ${names}. Supprimez-les dans Planning › Fermetures, puis recréez-les avec les bonnes dates.`;
}

/**
 * A new start must not swap the weeks of a « une semaine sur deux » course
 * aligned on it (#270): every upcoming lesson would be replaced, losing its
 * substitute or own time. Refused, naming the courses.
 */
async function swappedBiweekly(
  tx: Tx,
  seasonId: string,
  before: { start: string; end: string },
  after: { start: string; end: string },
  today: string,
): Promise<string | null> {
  const courses = await tx
    .select({
      recurrence: course.recurrence,
      weekday: course.weekday,
      startDate: course.startDate,
      endDate: course.endDate,
      discipline: discipline.name,
      level: course.level,
      startTime: sql<string>`to_char(${course.startTime}, 'HH24:MI')`,
      room: room.name,
    })
    .from(course)
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .where(and(eq(course.seasonId, seasonId), eq(course.recurrence, "biweekly")));
  const swapped = courses
    .filter((c) => biweeklySwapped(recurrenceOf({ ...c, dates: [] }), before, after, today))
    .map((c) => closedCourseLabel(c))
    .sort((a, b) => a.localeCompare(b, "fr"));
  if (swapped.length === 0) return null;
  return swapped.length === 1
    ? `Ce début de saison décalerait la première séance de ce cours une semaine sur deux d’un nombre impair de semaines, et inverserait ses semaines : ${swapped[0]}. Donnez à ce cours une date de début après le nouveau début de saison, sur une de ses semaines actuelles.`
    : `Ce début de saison décalerait la première séance de ces cours une semaine sur deux d’un nombre impair de semaines, et inverserait leurs semaines : ${swapped.join(", ")}. Donnez à ces cours une date de début après le nouveau début de saison, sur une de leurs semaines actuelles.`;
}

/**
 * New label or dates of a season. When the dates change, the season's
 * upcoming lessons follow them in the same transaction (#270): lessons are
 * created for added weeks, planned ones outside the dates removed, under the
 * rules of `syncLessons` (attendance taken, lesson pack counted: kept).
 * `outside` counts the lessons, not cancelled, still dated outside the new
 * dates afterwards, for the director to move or cancel them.
 */
export async function updateSeason(
  tx: Tx,
  id: string,
  entry: z.input<typeof validSeasonInput>,
  today: string,
): Promise<{ ok: true; id: string; outside: number } | { ok: false; message: string }> {
  const s = validSeasonInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!isUuid(id)) return { ok: false, message: "Cette saison n’existe plus." };
  // FOR UPDATE conflicts with the KEY SHARE of addClosure(): a closure being added commits first and is
  // checked below, or waits and reads the new dates (#194).
  const [current] = await tx
    .select({ start: season.startDate, end: season.endDate })
    .from(season)
    .where(eq(season.id, id))
    .for("update");
  if (!current) return { ok: false, message: "Cette saison n’existe plus." };
  const before = { start: current.start, end: current.end };
  const after = { start: s.data.startDate, end: s.data.endDate };
  const refusal =
    (await checkSeason(tx, s.data, id)) ??
    (await closuresOutside(tx, id, s.data)) ??
    (await quartersLeftOutside(tx, id, s.data)) ??
    (before.start !== after.start ? await swappedBiweekly(tx, id, before, after, today) : null);
  if (refusal) return { ok: false, message: refusal };
  const rows = await tx
    .update(season)
    .set(columnsOf(season, seasonRow(s.data)))
    .where(eq(season.id, id))
    .returning({ id: season.id });
  if (rows.length !== 1) return { ok: false, message: "Cette saison n’existe plus." };
  // A new label only: the lessons stay as they are.
  if (before.start === after.start && before.end === after.end) return { ok: true, id, outside: 0 };
  // Same transaction: the FOR NO KEY UPDATE syncLessons() takes is covered by the FOR UPDATE held above.
  await syncLessons(tx, id, today);
  const [{ outside }] = await tx
    .select({ outside: sql<number>`count(*)::int` })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(
      and(
        eq(course.seasonId, id),
        ne(lesson.status, "cancelled"),
        or(sql`${lesson.date} < ${s.data.startDate}`, sql`${lesson.date} > ${s.data.endDate}`),
      ),
    );
  return { ok: true, id, outside };
}

/** New season dates must keep its quarters inside them (#291): refused, naming them. */
async function quartersLeftOutside(
  tx: Tx,
  seasonId: string,
  s: z.output<typeof validSeasonInput>,
): Promise<string | null> {
  const outside = quartersOutside(await seasonQuarters(tx, [seasonId]), s);
  if (outside.length === 0) return null;
  const names = outside.map((q) => `${q.label} (du ${frenchDate(q.startDate)} au ${frenchDate(q.endDate)})`).join(", ");
  return outside.length === 1
    ? `Ce trimestre sortirait de la saison : ${names}. Modifiez d’abord les trimestres de la saison.`
    : `Ces trimestres sortiraient de la saison : ${names}. Modifiez d’abord les trimestres de la saison.`;
}

const quarterFields = z.object(
  {
    // null: a quarter to add.
    id: z.uuid().nullable(),
    label: z
      .string({ error: "Libellé du trimestre obligatoire" })
      .trim()
      .min(1, "Libellé du trimestre obligatoire")
      .max(30, "Libellé du trimestre : 30 caractères au plus"),
    startDate: z.iso.date("Date de trimestre invalide"),
    endDate: z.iso.date("Date de trimestre invalide"),
  },
  { error: "Saisie invalide." },
);
export const validQuarters = z.array(quarterFields).max(12, "12 trimestres au plus.");
export type QuarterEntry = z.input<typeof quarterFields>;

/**
 * Replaces the quarters of a season (#291): the ones with an id are updated, the others
 * added, the missing ones removed. Checked as a whole (`quartersRefusal`) under a lock on
 * the season row, so two saves or a season date change wait for each other. A quarter an
 * enrollment covers cannot be removed (its enrollments would owe less without a trace);
 * its dates and label can change. Quarters added or moved do not change the quarters of
 * enrollments already saved.
 */
export async function saveSeasonQuarters(tx: Tx, seasonId: string, entries: QuarterEntry[]): Promise<Result> {
  const parsed = validQuarters.safeParse(entries);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  if (!isUuid(seasonId)) return { ok: false, message: "Cette saison n’existe plus." };
  const [s] = await tx
    .select({ startDate: season.startDate, endDate: season.endDate })
    .from(season)
    .where(eq(season.id, seasonId))
    .for("update");
  if (!s) return { ok: false, message: "Cette saison n’existe plus." };
  const quarters = parsed.data;
  const refusal = quartersRefusal(quarters, s);
  if (refusal) return { ok: false, message: refusal };

  const current = await seasonQuarters(tx, [seasonId]);
  const kept = new Set(quarters.flatMap((q) => (q.id ? [q.id] : [])));
  if (
    quarters.some((q) => q.id && !current.some((c) => c.id === q.id)) ||
    kept.size !== quarters.filter((q) => q.id).length
  )
    return { ok: false, message: "Un trimestre a été modifié entre-temps : rechargez la page." };
  const removed = current.filter((c) => !kept.has(c.id));
  if (removed.length > 0) {
    const used = await tx
      .selectDistinct({ quarterId: enrollmentQuarter.quarterId })
      .from(enrollmentQuarter)
      .where(
        inArray(
          enrollmentQuarter.quarterId,
          removed.map((r) => r.id),
        ),
      );
    const named = removed.filter((r) => used.some((u) => u.quarterId === r.id)).map((r) => `« ${r.label} »`);
    if (named.length > 0)
      return {
        ok: false,
        message:
          named.length === 1
            ? `Le trimestre ${named[0]} est payé par des inscriptions : il ne peut pas être supprimé, seulement modifié.`
            : `Les trimestres ${named.join(", ")} sont payés par des inscriptions : ils ne peuvent pas être supprimés, seulement modifiés.`,
      };
    await tx.delete(seasonQuarter).where(
      inArray(
        seasonQuarter.id,
        removed.map((r) => r.id),
      ),
    );
  }
  for (const q of quarters)
    if (q.id)
      await tx
        .update(seasonQuarter)
        .set({ label: q.label, startDate: q.startDate, endDate: q.endDate })
        .where(and(eq(seasonQuarter.id, q.id), eq(seasonQuarter.seasonId, seasonId)));
  const added = quarters.filter((q) => !q.id);
  if (added.length > 0)
    await tx.insert(seasonQuarter).values(
      rowsOf(
        seasonQuarter,
        added.map((q) => ({
          schoolId: CURRENT_SCHOOL,
          seasonId,
          label: q.label,
          startDate: q.startDate,
          endDate: q.endDate,
        })),
      ),
    );
  return { ok: true, id: seasonId };
}

// ---------------------------------------------------------------------------
// Disciplines
// ---------------------------------------------------------------------------

export type DisciplineRow = {
  id: string;
  name: string;
  /** Adults enrolled in it bring a medical certificate (#306). */
  adultsNeedCertificate: boolean;
  course: number;
  tariffs: number;
};

export function listDisciplines(tx: Tx): Promise<DisciplineRow[]> {
  const id = sql`${discipline}.${sql.identifier("id")}`;
  return tx
    .select({
      id: discipline.id,
      name: discipline.name,
      adultsNeedCertificate: discipline.adultsNeedCertificate,
      course: account(sql`SELECT count(*) FROM course c WHERE c.discipline_id = ${id}`),
      tariffs: account(sql`SELECT count(*) FROM tariff t WHERE t.discipline_id = ${id}`),
    })
    .from(discipline)
    .orderBy(asc(discipline.name));
}

async function takenDisciplineName(tx: Tx, name: string, except?: string): Promise<boolean> {
  const [x] = await tx
    .select({ id: discipline.id })
    .from(discipline)
    .where(and(sql`lower(${discipline.name}) = lower(${name})`, except ? ne(discipline.id, except) : undefined));
  return Boolean(x);
}

export async function createDiscipline(tx: Tx, name: string): Promise<Result> {
  const n = validName.safeParse(name);
  if (!n.success) return { ok: false, message: n.error.issues[0].message };
  if (await takenDisciplineName(tx, n.data)) return { ok: false, message: "Cette discipline existe déjà." };
  const [{ id }] = await tx
    .insert(discipline)
    .values({ name: n.data, schoolId: CURRENT_SCHOOL })
    .returning({ id: discipline.id });
  return { ok: true, id };
}

export async function renameDiscipline(tx: Tx, id: string, name: string): Promise<Result> {
  const n = validName.safeParse(name);
  if (!n.success) return { ok: false, message: n.error.issues[0].message };
  if (!isUuid(id)) return { ok: false, message: "Cette discipline n’existe plus." };
  if (await takenDisciplineName(tx, n.data, id)) return { ok: false, message: "Cette discipline existe déjà." };
  const rows = await tx
    .update(discipline)
    .set({ name: n.data })
    .where(eq(discipline.id, id))
    .returning({ id: discipline.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Cette discipline n’existe plus." };
}

/**
 * Whether adults enrolled in the discipline bring a medical certificate (#306):
 * off for couple dances at the founding school. Minors and competitors always do.
 */
export async function setAdultsNeedCertificate(tx: Tx, id: string, value: boolean): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Cette discipline n’existe plus." };
  if (typeof value !== "boolean") return { ok: false, message: "Saisie invalide." };
  const rows = await tx
    .update(discipline)
    .set({ adultsNeedCertificate: value })
    .where(eq(discipline.id, id))
    .returning({ id: discipline.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Cette discipline n’existe plus." };
}

/** Refused while a course or a tariff uses it. */
export async function deleteDiscipline(tx: Tx, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Cette discipline n’existe plus." };
  const d = (await listDisciplines(tx)).find((x) => x.id === id);
  if (!d) return { ok: false, message: "Cette discipline n’existe plus." };
  if (d.course > 0 || d.tariffs > 0) {
    return {
      ok: false,
      message: `${d.name} est utilisée (${d.course} cours, ${d.tariffs} tarif${d.tariffs > 1 ? "s" : ""}) : retirez-les d’abord.`,
    };
  }
  await tx.delete(discipline).where(eq(discipline.id, id));
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Sites and rooms
// ---------------------------------------------------------------------------

export type RoomRow = { id: string; name: string; capacity: number | null; course: number };
export type SiteRow = {
  id: string;
  name: string;
  address: string;
  permanence: boolean;
  rooms: RoomRow[];
  hours: Hours[];
};

export async function listPlaces(tx: Tx): Promise<SiteRow[]> {
  const sites = await tx
    .select({ id: site.id, name: site.name, address: site.address, permanence: site.enrollmentDesk })
    .from(site)
    .orderBy(asc(site.name));
  const roomId = sql`${room}.${sql.identifier("id")}`;
  const rooms = await tx
    .select({
      id: room.id,
      siteId: room.siteId,
      name: room.name,
      capacity: room.capacity,
      course: account(sql`SELECT count(*) FROM course c WHERE c.room_id = ${roomId}`),
    })
    .from(room)
    .orderBy(asc(room.name));
  const hours = await hoursBySite(tx);
  return sites.map((s) => ({
    ...s,
    hours: hours[s.id] ?? [],
    rooms: rooms
      .filter((x) => x.siteId === s.id)
      .map((x) => ({ id: x.id, name: x.name, capacity: x.capacity, course: x.course })),
  }));
}

export const validSiteInput = z.object(
  {
    name: validName,
    address: z
      .string({ error: "Adresse obligatoire" })
      .trim()
      .min(1, "Adresse obligatoire")
      .max(300, "Adresse : 300 caractères au plus"),
    permanence: z.boolean({ error: "Saisie invalide." }),
  },
  { error: "Saisie invalide." },
);

/** Site columns from the form input. */
const siteRow = (s: z.output<typeof validSiteInput>) => ({
  name: s.name,
  address: s.address,
  enrollmentDesk: s.permanence,
});

export async function createSite(tx: Tx, entry: z.input<typeof validSiteInput>): Promise<Result> {
  const s = validSiteInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const [{ id }] = await tx
    .insert(site)
    .values(columnsOf(site, { ...siteRow(s.data), schoolId: CURRENT_SCHOOL }))
    .returning({ id: site.id });
  return { ok: true, id };
}

export async function updateSite(tx: Tx, id: string, entry: z.input<typeof validSiteInput>): Promise<Result> {
  const s = validSiteInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!isUuid(id)) return { ok: false, message: "Ce site n’existe plus." };
  const rows = await tx
    .update(site)
    .set(columnsOf(site, siteRow(s.data)))
    .where(eq(site.id, id))
    .returning({ id: site.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Ce site n’existe plus." };
}

/** Refused while the site has rooms. */
export async function deleteSite(tx: Tx, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Ce site n’existe plus." };
  const [s] = await tx.select({ name: site.name }).from(site).where(eq(site.id, id));
  if (!s) return { ok: false, message: "Ce site n’existe plus." };
  const [x] = await tx.select({ id: room.id }).from(room).where(eq(room.siteId, id)).limit(1);
  if (x) return { ok: false, message: `${s.name} a encore des salles : retirez-les d’abord.` };
  await tx.delete(site).where(eq(site.id, id));
  return { ok: true, id };
}

/** Opening hours of each site, by site id (days in order). */
export async function hoursBySite(tx: Tx): Promise<Record<string, Hours[]>> {
  const rows = await tx
    .select({
      siteId: siteHours.siteId,
      weekday: siteHours.weekday,
      opening: siteHours.opensAt,
      closure: siteHours.closesAt,
    })
    .from(siteHours)
    .orderBy(asc(siteHours.weekday));
  const r: Record<string, Hours[]> = {};
  for (const l of rows)
    (r[l.siteId] ??= []).push({
      weekday: l.weekday,
      opening: l.opening.slice(0, 5),
      closure: l.closure.slice(0, 5),
    });
  return r;
}

const timePattern = z
  .string({ error: "Heure au format HH:MM" })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM");
export const validHours = z
  .array(
    z.object(
      {
        weekday: z.int({ error: "Jour invalide" }).min(1, "Jour invalide").max(7, "Jour invalide"),
        opening: timePattern,
        closure: timePattern,
      },
      { error: "Horaires invalides" },
    ),
    { error: "Horaires invalides" },
  )
  .max(7, "7 jours au plus")
  .refine((h) => new Set(h.map((x) => x.weekday)).size === h.length, "Un même jour est saisi deux fois.")
  .refine((h) => h.every((x) => x.closure > x.opening), "L’heure de fermeture doit suivre l’ouverture.");

/** Replaces a site's opening hours; an empty list removes any opening-hours constraint. */
export async function saveHours(tx: Tx, siteId: string, entry: z.input<typeof validHours>): Promise<Result> {
  const h = validHours.safeParse(entry);
  if (!h.success) return { ok: false, message: h.error.issues[0].message };
  if (!isUuid(siteId)) return { ok: false, message: "Ce site n’existe plus." };
  const [s] = await tx.select({ id: site.id }).from(site).where(eq(site.id, siteId));
  if (!s) return { ok: false, message: "Ce site n’existe plus." };
  await tx.delete(siteHours).where(eq(siteHours.siteId, siteId));
  if (h.data.length > 0)
    await tx.insert(siteHours).values(
      rowsOf(
        siteHours,
        h.data.map((x) => ({
          weekday: x.weekday,
          opensAt: x.opening,
          closesAt: x.closure,
          siteId,
          schoolId: CURRENT_SCHOOL,
        })),
      ),
    );
  return { ok: true, id: siteId };
}

export const validRoomInput = z.object(
  {
    siteId: z.uuid({ error: "Choisissez un site" }),
    name: validName,
    capacity: z
      .int({ error: "Capacité : un nombre entier de personnes" })
      .min(1, "Capacité d’au moins 1 personne")
      .max(1000, "Capacité de 1 000 personnes au plus")
      .nullable(),
  },
  { error: "Saisie invalide." },
);

/** Room columns from the form input. */
const roomRow = (s: z.output<typeof validRoomInput>) => ({ siteId: s.siteId, name: s.name, capacity: s.capacity });

export async function createRoom(tx: Tx, entry: z.input<typeof validRoomInput>): Promise<Result> {
  const s = validRoomInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.data.siteId));
  if (!x) return { ok: false, message: "Site introuvable." };
  const [{ id }] = await tx
    .insert(room)
    .values(columnsOf(room, { ...roomRow(s.data), schoolId: CURRENT_SCHOOL }))
    .returning({ id: room.id });
  return { ok: true, id };
}

export async function updateRoom(tx: Tx, id: string, entry: z.input<typeof validRoomInput>): Promise<Result> {
  const s = validRoomInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!isUuid(id)) return { ok: false, message: "Cette salle n’existe plus." };
  const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.data.siteId));
  if (!x) return { ok: false, message: "Site introuvable." };
  const rows = await tx
    .update(room)
    .set(columnsOf(room, roomRow(s.data)))
    .where(eq(room.id, id))
    .returning({ id: room.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Cette salle n’existe plus." };
}

/** Site of a room, or null if it does not exist. */
export async function roomSiteId(tx: Tx, id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [r] = await tx.select({ siteId: room.siteId }).from(room).where(eq(room.id, id));
  return r?.siteId ?? null;
}

/** Refused while a course (of any season) takes place in the room. */
export async function deleteRoom(tx: Tx, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Cette salle n’existe plus." };
  const [s] = await tx.select({ name: room.name }).from(room).where(eq(room.id, id));
  if (!s) return { ok: false, message: "Cette salle n’existe plus." };
  const [c] = await tx.select({ id: course.id }).from(course).where(eq(course.roomId, id)).limit(1);
  if (c) return { ok: false, message: `Des cours ont lieu dans ${s.name} : déplacez-les d’abord.` };
  await tx.delete(room).where(eq(room.id, id));
  return { ok: true, id };
}
