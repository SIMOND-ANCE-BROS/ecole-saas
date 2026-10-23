"use server";

import { revalidatePath } from "next/cache";
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
} from "@/db/settings";
import { saveLessonPack, saveSiblings, savePrice, deleteLessonPack } from "@/db/tariffs";
import { requireRole } from "@/lib/session";

type Back = { message: string | null };

/** Settings: management only; each action revalidates the page concerned. */
async function act(
  page: string,
  action: (tx: Tx) => Promise<{ ok: true } | { ok: false; message: string }>,
): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("director");
  const r = await withSchool(schoolId, action);
  revalidatePath(`/parametres/${page}`);
  return { message: r.ok ? null : r.message };
}

export async function newSeason(entry: unknown, copyFrom: string | null) {
  return act("saisons", (tx) => createSeason(tx, entry as never, copyFrom));
}
export async function changeSeason(id: string, entry: unknown) {
  return act("saisons", (tx) => updateSeason(tx, id, entry as never));
}

export async function newDiscipline(name: string) {
  return act("disciplines", (tx) => createDiscipline(tx, name));
}
export async function rename(id: string, name: string) {
  return act("disciplines", (tx) => renameDiscipline(tx, id, name));
}
export async function removeDiscipline(id: string) {
  return act("disciplines", (tx) => deleteDiscipline(tx, id));
}

export async function newSite(entry: unknown) {
  return act("lieux", (tx) => createSite(tx, entry as never));
}
export async function changeSite(id: string, entry: unknown) {
  return act("lieux", (tx) => updateSite(tx, id, entry as never));
}
export async function changeHours(siteId: string, hours: unknown) {
  const r = await act("lieux", (tx) => saveHours(tx, siteId, hours as never));
  // The schedule calendar depends on the opening hours.
  revalidatePath("/planning");
  return r;
}
export async function removeSite(id: string) {
  return act("lieux", (tx) => deleteSite(tx, id));
}
export async function newRoom(entry: unknown) {
  return act("lieux", (tx) => createRoom(tx, entry as never));
}
export async function changeRoom(id: string, entry: unknown) {
  return act("lieux", (tx) => updateRoom(tx, id, entry as never));
}
export async function removeRoom(id: string) {
  return act("lieux", (tx) => deleteRoom(tx, id));
}

export async function cellPrice(seasonId: string, entry: unknown) {
  return act("tarifs", (tx) => savePrice(tx, seasonId, entry as never));
}
export async function siblingsRule(seasonId: string, entry: unknown) {
  return act("tarifs", (tx) => saveSiblings(tx, seasonId, entry as never));
}
export async function lessonPack(seasonId: string, entry: unknown) {
  return act("tarifs", (tx) => saveLessonPack(tx, seasonId, entry as never));
}
export async function removeLessonPack(id: string) {
  return act("tarifs", (tx) => deleteLessonPack(tx, id));
}
