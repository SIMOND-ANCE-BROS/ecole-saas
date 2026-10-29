"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSchool, type Tx } from "@/db";
import {
  createDiscipline,
  createSeason,
  createRoom,
  createSite,
  saveHours,
  updateSeason,
  updateRoom,
  updateSite,
  renameDiscipline,
  deleteDiscipline,
  deleteRoom,
  deleteSite,
  roomSiteId,
  validHours,
  validRoomInput,
  validSeasonInput,
  validSiteInput,
  validName,
} from "@/db/settings";
import { syncRoomSeasons } from "@/db/lessons";
import { todayInParis } from "@/domain/people/age";
import {
  saveLessonPack,
  saveSiblings,
  savePrice,
  deleteLessonPack,
  validCell,
  validLessonPack,
  validSiblings,
} from "@/db/tariffs";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

type Write = (tx: Tx) => Promise<{ ok: true } | { ok: false; message: string }>;

// Typed for the call sites; still parsed, since a server action receives whatever the browser sends.
// The database layer parses again and refuses with the same messages.
const validId = z.uuid();

/** A discipline name: the database layer's schema; anything but text is refused with its message too. */
const nameRefusal = (name: unknown) => (typeof name === "string" ? refusal(validName, name) : "Nom obligatoire");

/** The first French message of a refused input, or null when it is acceptable. */
function refusal(schema: z.ZodType, value: unknown, message?: string): string | null {
  const r = schema.safeParse(value);
  return r.success ? null : (message ?? r.error.issues[0]?.message ?? "Saisie invalide.");
}

/**
 * Settings: management only, checked before anything else; a refused input
 * never reaches the database; each action revalidates the page concerned.
 */
async function act(page: string, refused: () => string | null, write: Write): Promise<ActionResult> {
  const { schoolId } = await requireRole("director");
  const message = refused();
  if (message) return { ok: false, message };
  const r = await withSchool(schoolId, write);
  revalidatePath(`/parametres/${page}`);
  return actionResult(r);
}

const SEASON_GONE = "Cette saison n’existe plus.";
const DISCIPLINE_GONE = "Cette discipline n’existe plus.";
const SITE_GONE = "Ce site n’existe plus.";
const ROOM_GONE = "Cette salle n’existe plus.";
const NO_SEASON = "Saison introuvable.";

export async function newSeason(entry: z.input<typeof validSeasonInput>, copyFrom: string | null) {
  return act(
    "saisons",
    () => refusal(validSeasonInput, entry) ?? refusal(validId.nullable(), copyFrom, "Saison de référence introuvable."),
    (tx) => createSeason(tx, entry, copyFrom),
  );
}
/** French note on the lessons a season edit leaves outside its new dates (#270), or null. */
function outsideNote(outside: number): string | null {
  if (outside === 0) return null;
  return outside === 1
    ? "1 séance reste en dehors des nouvelles dates (déjà faite, avec carnet ou déplacée) : déplacez-la ou annulez-la dans le planning si besoin."
    : `${outside} séances restent en dehors des nouvelles dates (déjà faites, avec carnet ou déplacées) : déplacez-les ou annulez-les dans le planning si besoin.`;
}

/** The season's lessons follow its new dates (#270); `note` names those left outside them. */
export async function changeSeason(
  id: string,
  entry: z.input<typeof validSeasonInput>,
): Promise<ActionResult<{ note: string | null }>> {
  const { schoolId } = await requireRole("director");
  const message = refusal(validSeasonInput, entry) ?? refusal(validId, id, SEASON_GONE);
  if (message) return { ok: false, message };
  const r = await withSchool(schoolId, (tx) => updateSeason(tx, id, entry, todayInParis()));
  revalidatePath("/parametres/saisons");
  // Every planning page, and the home page's lessons of the day.
  revalidatePath("/planning", "layout");
  revalidatePath("/");
  return r.ok ? { ok: true, note: outsideNote(r.outside) } : { ok: false, message: r.message };
}

export async function newDiscipline(name: string) {
  return act(
    "disciplines",
    () => nameRefusal(name),
    (tx) => createDiscipline(tx, name),
  );
}
export async function rename(id: string, name: string) {
  return act(
    "disciplines",
    () => nameRefusal(name) ?? refusal(validId, id, DISCIPLINE_GONE),
    (tx) => renameDiscipline(tx, id, name),
  );
}
export async function removeDiscipline(id: string) {
  return act(
    "disciplines",
    () => refusal(validId, id, DISCIPLINE_GONE),
    (tx) => deleteDiscipline(tx, id),
  );
}

export async function newSite(entry: z.input<typeof validSiteInput>) {
  return act(
    "lieux",
    () => refusal(validSiteInput, entry),
    (tx) => createSite(tx, entry),
  );
}
export async function changeSite(id: string, entry: z.input<typeof validSiteInput>) {
  return act(
    "lieux",
    () => refusal(validSiteInput, entry) ?? refusal(validId, id, SITE_GONE),
    (tx) => updateSite(tx, id, entry),
  );
}
export async function changeHours(siteId: string, hours: z.input<typeof validHours>) {
  const r = await act(
    "lieux",
    () => refusal(validHours, hours) ?? refusal(validId, siteId, SITE_GONE),
    (tx) => saveHours(tx, siteId, hours),
  );
  // The schedule calendar depends on the opening hours.
  revalidatePath("/planning");
  return r;
}
export async function removeSite(id: string) {
  return act(
    "lieux",
    () => refusal(validId, id, SITE_GONE),
    (tx) => deleteSite(tx, id),
  );
}
export async function newRoom(entry: z.input<typeof validRoomInput>) {
  return act(
    "lieux",
    () => refusal(validRoomInput, entry),
    (tx) => createRoom(tx, entry),
  );
}
export async function changeRoom(id: string, entry: z.input<typeof validRoomInput>) {
  const r = await act(
    "lieux",
    () => refusal(validRoomInput, entry) ?? refusal(validId, id, ROOM_GONE),
    async (tx) => {
      const before = await roomSiteId(tx, id);
      const result = await updateRoom(tx, id, entry);
      // Another site: its closures, not the old site's, now cover the room's courses (#200).
      if (result.ok && before !== (await roomSiteId(tx, id))) await syncRoomSeasons(tx, id, todayInParis());
      return result;
    },
  );
  revalidatePath("/planning");
  return r;
}
export async function removeRoom(id: string) {
  return act(
    "lieux",
    () => refusal(validId, id, ROOM_GONE),
    (tx) => deleteRoom(tx, id),
  );
}

export async function cellPrice(seasonId: string, entry: z.input<typeof validCell>) {
  return act(
    "tarifs",
    () => refusal(validCell, entry) ?? refusal(validId, seasonId, NO_SEASON),
    (tx) => savePrice(tx, seasonId, entry),
  );
}
/** Siblings discount rule of the season; null removes it. */
export async function siblingsRule(seasonId: string, entry: z.input<typeof validSiblings> | null) {
  return act(
    "tarifs",
    () => refusal(validId, seasonId, NO_SEASON) ?? (entry === null ? null : refusal(validSiblings, entry)),
    (tx) => saveSiblings(tx, seasonId, entry),
  );
}
export async function lessonPack(seasonId: string, entry: z.input<typeof validLessonPack>) {
  return act(
    "tarifs",
    () => refusal(validLessonPack, entry) ?? refusal(validId, seasonId, NO_SEASON),
    (tx) => saveLessonPack(tx, seasonId, entry),
  );
}
export async function removeLessonPack(id: string) {
  return act(
    "tarifs",
    () => refusal(validId, id, "Ce carnet n’existe plus."),
    (tx) => deleteLessonPack(tx, id),
  );
}
