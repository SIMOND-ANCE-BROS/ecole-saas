"use server";

import { revalidatePath } from "next/cache";
import { avecEcole } from "@/db";
import { saisonCourante } from "@/db/planning";
import {
  ajouterFermeture,
  annulerSeance,
  changerIntervenant,
  enregistrerAppel,
  retablirSeance,
  supprimerFermeture,
  synchroniserSeances,
} from "@/db/seances";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";

type Retour = { message: string | null };
const retour = (r: { ok: true } | { ok: false; message: string }): Retour => ({ message: r.ok ? null : r.message });

/** Appel d'une séance : accueil et direction. */
export async function faireAppel(seanceId: string, presences: unknown): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => enregistrerAppel(tx, seanceId, presences as never));
  revalidatePath(`/planning/seances/${seanceId}`);
  return retour(r);
}

export async function remplacer(seanceId: string, intervenantId: string): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => changerIntervenant(tx, seanceId, intervenantId));
  revalidatePath(`/planning/seances/${seanceId}`);
  return retour(r);
}

export async function annuler(seanceId: string, annulee: boolean): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => (annulee ? annulerSeance(tx, seanceId) : retablirSeance(tx, seanceId)));
  revalidatePath(`/planning/seances/${seanceId}`);
  return retour(r);
}

/** Fermetures de la saison courante : direction ; les séances à venir suivent aussitôt. */
async function surSaison(action: (saisonId: string) => Parameters<typeof avecEcole>[1]): Promise<Retour> {
  const { ecoleId } = await exigerRole("direction");
  const aujourdhui = aujourdhuiAParis();
  const r = await avecEcole(ecoleId, async (tx) => {
    const saison = await saisonCourante(tx, aujourdhui);
    if (!saison) return { ok: false as const, message: "Aucune saison n’est paramétrée." };
    const resultat = (await action(saison.id)(tx)) as { ok: true } | { ok: false; message: string };
    if (resultat.ok) await synchroniserSeances(tx, saison.id, aujourdhui);
    return resultat;
  });
  revalidatePath("/planning/fermetures");
  return retour(r);
}

export async function fermer(saisie: unknown): Promise<Retour> {
  return surSaison((saisonId) => (tx) => ajouterFermeture(tx, saisonId, saisie as never));
}

export async function rouvrir(fermetureId: string): Promise<Retour> {
  return surSaison(() => (tx) => supprimerFermeture(tx, fermetureId));
}

/** Recalcule les séances à venir (après un import, ou au premier usage). */
export async function mettreAJourSeances(): Promise<Retour> {
  return surSaison(() => async () => ({ ok: true }));
}
