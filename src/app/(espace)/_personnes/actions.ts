"use server";

import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import {
  creerPersonne,
  type Doublon,
  modifierPersonne,
  rechercherPersonnes,
  saisiePersonneValide,
} from "@/db/personnes";
import { erreursDe } from "@/lib/erreurs-saisie";
import { exigerRole } from "@/lib/session";

export type Refus = { message: string; erreurs: Partial<Record<string, string>>; doublons?: Doublon[] };

/** Nouveau contact (parent, payeur, organisme) ; sans `confirme`, renvoie d'abord les doublons probables. */
export async function creerContact(saisie: unknown, confirme: boolean): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const p = saisiePersonneValide.safeParse(saisie);
  if (!p.success) return { message: "Vérifiez les champs signalés.", erreurs: erreursDe(p.error.issues) };
  const r = await avecEcole(ecoleId, (tx) => creerPersonne(tx, p.data, confirme));
  if (r.statut === "doublons")
    return { message: "Cette personne existe peut-être déjà.", erreurs: {}, doublons: r.doublons };
  redirect(`/contacts/${r.id}?enregistre=cree`);
}

/** Identité et coordonnées d'un élève ou d'un contact. */
export async function modifierIdentite(id: string, saisie: unknown, retour: "eleves" | "contacts"): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const p = saisiePersonneValide.safeParse(saisie);
  if (!p.success) return { message: "Vérifiez les champs signalés.", erreurs: erreursDe(p.error.issues) };
  const r = await avecEcole(ecoleId, (tx) => modifierPersonne(tx, id, p.data));
  if (!r.ok) return { message: r.message, erreurs: {} };
  redirect(`/${retour}/${id}?enregistre=modifie`);
}

/** Recherche d'une personne existante pendant la frappe (responsable, payeur). */
export async function chercherPersonnes(saisie: string) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  if (typeof saisie !== "string") return [];
  return avecEcole(ecoleId, (tx) => rechercherPersonnes(tx, saisie.slice(0, 100)));
}
