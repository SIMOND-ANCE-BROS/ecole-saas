import { and, asc, desc, eq, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Hours } from "../domain/schedule/hours";
import type { Tx } from "./index";
import { course, discipline, siteHours, season, room, site } from "./schema";

/**
 * School settings (#80): seasons, disciplines, sites and rooms. Everything
 * specific to a school is entered here, never in code. Always within
 * the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
export type Result = { ok: true; id: string } | { ok: false; message: string };
const validName = z.string().trim().min(1, "Nom obligatoire").max(100);
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
};

export function listSeasons(tx: Tx): Promise<SeasonRow[]> {
  const id = sql`${season}.${sql.identifier("id")}`;
  return tx
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
}

export const validSeasonInput = z
  .object({
    label: z.string().trim().min(1, "Libellé obligatoire").max(30),
    startDate: z.iso.date("Date invalide"),
    endDate: z.iso.date("Date invalide"),
  })
  .refine((s) => s.endDate > s.startDate, { path: ["endDate"], message: "La fin doit suivre le début." });

/** Season columns from the form input. */
const seasonRow = (s: z.output<typeof validSeasonInput>) => ({
  label: s.label,
  startDate: s.startDate,
  endDate: s.endDate,
});

async function checkSeason(tx: Tx, s: z.output<typeof validSeasonInput>, except?: string): Promise<string | null> {
  const autre = except ? ne(season.id, except) : undefined;
  const [duplicate] = await tx
    .select({ id: season.id })
    .from(season)
    .where(and(eq(season.label, s.label), autre));
  if (duplicate) return "Une saison porte déjà ce libellé.";
  const [overlaps] = await tx
    .select({ label: season.label })
    .from(season)
    .where(and(sql`${season.startDate} <= ${s.endDate}`, sql`${season.endDate} >= ${s.startDate}`, autre));
  return overlaps ? `Ces dates chevauchent la saison ${overlaps.label}.` : null;
}

/**
 * Creates a season; with `copyFrom`, copies that season's tariff grid,
 * discounts and lesson packs (prices still to be reviewed).
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
    .values({ ...seasonRow(s.data), schoolId: CURRENT_SCHOOL })
    .returning({ id: season.id });
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

export async function updateSeason(tx: Tx, id: string, entry: z.input<typeof validSeasonInput>): Promise<Result> {
  const s = validSeasonInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!isUuid(id)) return { ok: false, message: "Cette saison n’existe plus." };
  const refusal = await checkSeason(tx, s.data, id);
  if (refusal) return { ok: false, message: refusal };
  const rows = await tx.update(season).set(seasonRow(s.data)).where(eq(season.id, id)).returning({ id: season.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Cette saison n’existe plus." };
}

// ---------------------------------------------------------------------------
// Disciplines
// ---------------------------------------------------------------------------

export type DisciplineRow = { id: string; name: string; course: number; tariffs: number };

export function listDisciplines(tx: Tx): Promise<DisciplineRow[]> {
  const id = sql`${discipline}.${sql.identifier("id")}`;
  return tx
    .select({
      id: discipline.id,
      name: discipline.name,
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
  salles: RoomRow[];
  hours: Hours[];
};

export async function listPlaces(tx: Tx): Promise<SiteRow[]> {
  const sites = await tx
    .select({ id: site.id, name: site.name, address: site.address, permanence: site.enrollmentDesk })
    .from(site)
    .orderBy(asc(site.name));
  const roomId = sql`${room}.${sql.identifier("id")}`;
  const salles = await tx
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
    salles: salles
      .filter((x) => x.siteId === s.id)
      .map((x) => ({ id: x.id, name: x.name, capacity: x.capacity, course: x.course })),
  }));
}

export const validSiteInput = z.object({
  name: validName,
  address: z.string().trim().min(1, "Adresse obligatoire").max(300),
  permanence: z.boolean(),
});

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
    .values({ ...siteRow(s.data), schoolId: CURRENT_SCHOOL })
    .returning({ id: site.id });
  return { ok: true, id };
}

export async function updateSite(tx: Tx, id: string, entry: z.input<typeof validSiteInput>): Promise<Result> {
  const s = validSiteInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!isUuid(id)) return { ok: false, message: "Ce site n’existe plus." };
  const rows = await tx.update(site).set(siteRow(s.data)).where(eq(site.id, id)).returning({ id: site.id });
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

const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM");
export const validHours = z
  .array(z.object({ weekday: z.int().min(1).max(7), opening: heure, closure: heure }))
  .max(7)
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
      h.data.map((x) => ({
        weekday: x.weekday,
        opensAt: x.opening,
        closesAt: x.closure,
        siteId,
        schoolId: CURRENT_SCHOOL,
      })),
    );
  return { ok: true, id: siteId };
}

export const validRoomInput = z.object({
  siteId: z.uuid(),
  name: validName,
  capacity: z.int().min(1).max(1000).nullable(),
});

/** Room columns from the form input. */
const roomRow = (s: z.output<typeof validRoomInput>) => ({ siteId: s.siteId, name: s.name, capacity: s.capacity });

export async function createRoom(tx: Tx, entry: z.input<typeof validRoomInput>): Promise<Result> {
  const s = validRoomInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.data.siteId));
  if (!x) return { ok: false, message: "Site introuvable." };
  const [{ id }] = await tx
    .insert(room)
    .values({ ...roomRow(s.data), schoolId: CURRENT_SCHOOL })
    .returning({ id: room.id });
  return { ok: true, id };
}

export async function updateRoom(tx: Tx, id: string, entry: z.input<typeof validRoomInput>): Promise<Result> {
  const s = validRoomInput.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  if (!isUuid(id)) return { ok: false, message: "Cette salle n’existe plus." };
  const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.data.siteId));
  if (!x) return { ok: false, message: "Site introuvable." };
  const rows = await tx.update(room).set(roomRow(s.data)).where(eq(room.id, id)).returning({ id: room.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Cette salle n’existe plus." };
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
