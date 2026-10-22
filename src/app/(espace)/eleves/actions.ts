"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import {
  ajouterResponsable,
  changerPrevenir,
  creerEleve,
  definirFacturation,
  facturerA,
  type DoublonRole,
  marquerEleve,
  RefusCreation,
  saisieEleveValide,
} from "@/db/eleves";
import { supprimerLien } from "@/db/personnes";
import { erreursDe } from "@/lib/erreurs-saisie";
import { exigerRole } from "@/lib/session";

export type RefusEleve = { message: string; erreurs: Partial<Record<string, string>>; doublons?: DoublonRole[] };
type Retour = { message: string | null };
const retour = (r: { ok: true } | { ok: false; message: string }): Retour => ({ message: r.ok ? null : r.message });

/** Élève, responsable et payeur en une seule saisie ; sans `confirme`, renvoie d'abord les doublons probables. */
export async function creerEleveGuide(saisie: unknown, confirme: boolean): Promise<RefusEleve> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const s = saisieEleveValide.safeParse(saisie);
  if (!s.success) return { message: "Vérifiez les champs signalés.", erreurs: erreursDe(s.error.issues) };
  let r;
  try {
    r = await avecEcole(ecoleId, (tx) => creerEleve(tx, s.data, confirme));
  } catch (e) {
    if (e instanceof RefusCreation) return { message: e.message, erreurs: {} };
    throw e;
  }
  if (r.statut === "doublons")
    return { message: "Certaines personnes existent peut-être déjà.", erreurs: {}, doublons: r.doublons };
  redirect(`/eleves/${r.id}?enregistre=cree`);
}

export async function facturer(
  eleveId: string,
  cible: { type: "eleve" } | { type: "personne"; id: string },
): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => definirFacturation(tx, eleveId, cible));
  revalidatePath(`/eleves/${eleveId}`);
  return retour(r);
}

/** Facturer une personne connue ou créée à l'instant (organisme, autre proche). */
export async function facturerNouvelle(eleveId: string, payeur: unknown): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => facturerA(tx, eleveId, payeur as never));
  revalidatePath(`/eleves/${eleveId}`);
  return retour(r);
}

export async function ajouterUnResponsable(eleveId: string, responsable: unknown, aPrevenir: boolean): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => ajouterResponsable(tx, eleveId, responsable as never, aPrevenir));
  revalidatePath(`/eleves/${eleveId}`);
  return retour(r);
}

export async function prevenir(eleveId: string, lienId: string, aPrevenir: boolean): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => changerPrevenir(tx, lienId, aPrevenir));
  revalidatePath(`/eleves/${eleveId}`);
  return retour(r);
}

export async function retirerProche(eleveId: string, lienId: string): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => supprimerLien(tx, lienId));
  revalidatePath(`/eleves/${eleveId}`);
  return retour(r);
}

/** Un contact (un parent qui danse aussi) devient élève. */
export async function devenirEleve(id: string): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => marquerEleve(tx, id, true));
  if (!r.ok) return retour(r);
  redirect(`/eleves/${id}`);
}
