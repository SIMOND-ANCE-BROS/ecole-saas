"use server";

import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import { creerCours, lireCours, modifierCours, saisieCoursValide, supprimerCours } from "@/db/cours";
import { conflitsCreneau } from "@/db/disponibilites";
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

/** Dates à venir où l'intervenant choisi serait indisponible sur ce créneau (pendant la saisie). */
export async function verifierCreneau(
  coursId: string | null,
  creneau: { intervenantId: string; jourSemaine: number; heureDebut: string; dureeMinutes: number },
): Promise<string[]> {
  const { ecoleId } = await exigerRole("direction");
  const aujourdhui = aujourdhuiAParis();
  return avecEcole(ecoleId, async (tx) => {
    const saisonId = coursId ? (await lireCours(tx, coursId))?.saisonId : (await saisonCourante(tx, aujourdhui))?.id;
    return saisonId ? conflitsCreneau(tx, { ...creneau, saisonId }, aujourdhui) : [];
  });
}
