"use server";

import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import { creerCours, modifierCours, saisieCoursValide, supprimerCours } from "@/db/cours";
import { saisonCourante } from "@/db/planning";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";

export type Refus = { message: string; erreurs: Partial<Record<string, string>> };

/** Crée (id null) ou modifie un cours de la saison courante ; réservé à la direction. */
export async function enregistrerCours(id: string | null, saisie: unknown): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction");
  const donnees = saisieCoursValide.safeParse(saisie);
  if (!donnees.success) {
    const erreurs: Refus["erreurs"] = {};
    for (const p of donnees.error.issues) erreurs[String(p.path[0])] ??= p.message;
    return { message: "Vérifiez les champs signalés.", erreurs };
  }
  const resultat = await avecEcole(ecoleId, async (tx) => {
    if (id !== null) return modifierCours(tx, id, donnees.data);
    const saison = await saisonCourante(tx, aujourdhuiAParis());
    return saison ? creerCours(tx, saison.id, donnees.data) : { ok: false as const, message: "Aucune saison n’est paramétrée." };
  });
  if (!resultat.ok) return { message: resultat.message, erreurs: {} };
  redirect(id === null ? `/planning?enregistre=${resultat.id}` : `/planning/cours/${resultat.id}?modifie=1`);
}

export async function supprimer(id: string): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction");
  const resultat = await avecEcole(ecoleId, (tx) => supprimerCours(tx, id));
  if (!resultat.ok) return { message: resultat.message, erreurs: {} };
  redirect("/planning?supprime=1");
}
