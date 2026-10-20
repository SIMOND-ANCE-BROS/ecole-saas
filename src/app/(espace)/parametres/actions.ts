"use server";

import { revalidatePath } from "next/cache";
import { avecEcole, type Tx } from "@/db";
import {
  creerDiscipline,
  creerSaison,
  creerSalle,
  creerSite,
  modifierSaison,
  modifierSalle,
  modifierSite,
  renommerDiscipline,
  supprimerDiscipline,
  supprimerSalle,
  supprimerSite,
} from "@/db/parametres";
import { exigerRole } from "@/lib/session";

type Retour = { message: string | null };

/** Paramètres : direction seulement ; chaque action recharge la page concernée. */
async function agir(page: string, action: (tx: Tx) => Promise<{ ok: true } | { ok: false; message: string }>): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction");
  const r = await avecEcole(ecoleId, action);
  revalidatePath(`/parametres/${page}`);
  return { message: r.ok ? null : r.message };
}

export async function nouvelleSaison(saisie: unknown, reprendreDe: string | null) {
  return agir("saisons", (tx) => creerSaison(tx, saisie as never, reprendreDe));
}
export async function changerSaison(id: string, saisie: unknown) {
  return agir("saisons", (tx) => modifierSaison(tx, id, saisie as never));
}

export async function nouvelleDiscipline(nom: string) {
  return agir("disciplines", (tx) => creerDiscipline(tx, nom));
}
export async function renommer(id: string, nom: string) {
  return agir("disciplines", (tx) => renommerDiscipline(tx, id, nom));
}
export async function retirerDiscipline(id: string) {
  return agir("disciplines", (tx) => supprimerDiscipline(tx, id));
}

export async function nouveauSite(saisie: unknown) {
  return agir("lieux", (tx) => creerSite(tx, saisie as never));
}
export async function changerSite(id: string, saisie: unknown) {
  return agir("lieux", (tx) => modifierSite(tx, id, saisie as never));
}
export async function retirerSite(id: string) {
  return agir("lieux", (tx) => supprimerSite(tx, id));
}
export async function nouvelleSalle(saisie: unknown) {
  return agir("lieux", (tx) => creerSalle(tx, saisie as never));
}
export async function changerSalle(id: string, saisie: unknown) {
  return agir("lieux", (tx) => modifierSalle(tx, id, saisie as never));
}
export async function retirerSalle(id: string) {
  return agir("lieux", (tx) => supprimerSalle(tx, id));
}
