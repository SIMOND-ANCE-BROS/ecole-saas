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
} from "@/db/parametres";
import { saveLessonPack, saveSiblings, savePrice, deleteLessonPack } from "@/db/tarifs";
import { requireRole } from "@/lib/session";

type Back = { message: string | null };

/** Paramètres : direction seulement ; chaque action recharge la page concernée. */
async function act(
  page: string,
  action: (tx: Tx) => Promise<{ ok: true } | { ok: false; message: string }>,
): Promise<Back> {
  const { schoolId: schoolId } = await requireRole("direction");
  const r = await withSchool(schoolId, action);
  revalidatePath(`/parametres/${page}`);
  return { message: r.ok ? null : r.message };
}

export async function newSeason(saisie: unknown, copyFrom: string | null) {
  return act("saisons", (tx) => createSeason(tx, saisie as never, copyFrom));
}
export async function changeSeason(id: string, saisie: unknown) {
  return act("saisons", (tx) => updateSeason(tx, id, saisie as never));
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

export async function newSite(saisie: unknown) {
  return act("lieux", (tx) => createSite(tx, saisie as never));
}
export async function changeSite(id: string, saisie: unknown) {
  return act("lieux", (tx) => updateSite(tx, id, saisie as never));
}
export async function changeHours(siteId: string, hours: unknown) {
  const r = await act("lieux", (tx) => saveHours(tx, siteId, hours as never));
  // L'agenda du planning dépend des horaires.
  revalidatePath("/planning");
  return r;
}
export async function removeSite(id: string) {
  return act("lieux", (tx) => deleteSite(tx, id));
}
export async function newRoom(saisie: unknown) {
  return act("lieux", (tx) => createRoom(tx, saisie as never));
}
export async function changeRoom(id: string, saisie: unknown) {
  return act("lieux", (tx) => updateRoom(tx, id, saisie as never));
}
export async function removeRoom(id: string) {
  return act("lieux", (tx) => deleteRoom(tx, id));
}

export async function cellPrice(seasonId: string, saisie: unknown) {
  return act("tarifs", (tx) => savePrice(tx, seasonId, saisie as never));
}
export async function siblingsRule(seasonId: string, saisie: unknown) {
  return act("tarifs", (tx) => saveSiblings(tx, seasonId, saisie as never));
}
export async function lessonPack(seasonId: string, saisie: unknown) {
  return act("tarifs", (tx) => saveLessonPack(tx, seasonId, saisie as never));
}
export async function removeLessonPack(id: string) {
  return act("tarifs", (tx) => deleteLessonPack(tx, id));
}
