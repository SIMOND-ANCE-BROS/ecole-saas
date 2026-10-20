"use server";

import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import { creerCours, lireCours, modifierCours, saisieCoursValide, supprimerCours } from "@/db/cours";
import { saisonCourante } from "@/db/planning";
import { synchroniserSeances } from "@/db/seances";
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
  const aujourdhui = aujourdhuiAParis();
  const resultat = await avecEcole(ecoleId, async (tx) => {
    const saisonId = id !== null ? (await lireCours(tx, id))?.saisonId : (await saisonCourante(tx, aujourdhui))?.id;
    if (!saisonId) return { ok: false as const, message: id !== null ? "Ce cours n’existe plus." : "Aucune saison n’est paramétrée." };
    const r = id !== null ? await modifierCours(tx, id, donnees.data) : await creerCours(tx, saisonId, donnees.data);
    // Séances à venir recalculées dans la même transaction (jour changé, nouveau cours…).
    if (r.ok) await synchroniserSeances(tx, saisonId, aujourdhui);
    return r;
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
