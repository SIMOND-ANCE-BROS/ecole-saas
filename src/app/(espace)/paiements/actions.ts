"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import { corrigerPaiement, encaisser } from "@/db/paiements";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";

/** Retour vers la fiche du payeur : seulement une fiche élève ou contact. */
const retourValide = (r: unknown) =>
  typeof r === "string" && /^\/(eleves|contacts)\/[0-9a-f-]{36}$/.test(r) ? r : null;

/** Encaisse un ou plusieurs règlements (accueil et direction), puis revient à la fiche du payeur. */
export async function encaisserReglements(
  payeurId: string,
  saisie: unknown,
  retour: unknown,
): Promise<{ message: string }> {
  const { ecoleId, userId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => encaisser(tx, userId, payeurId, saisie as never));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect(`${retourValide(retour) ?? `/personnes/${payeurId}`}?encaisse=${r.ids.length}`);
}

/** Correction d'un paiement par un paiement négatif : direction seulement. */
export async function corriger(
  paiementId: string,
  montantCentimes: number,
  retour: unknown,
): Promise<{ message: string | null }> {
  const { ecoleId, userId } = await exigerRole("direction");
  const r = await avecEcole(ecoleId, (tx) =>
    corrigerPaiement(tx, userId, paiementId, montantCentimes, aujourdhuiAParis()),
  );
  if (!r.ok) return { message: r.message };
  const chemin = retourValide(retour);
  if (chemin) revalidatePath(chemin);
  revalidatePath("/encaissements");
  return { message: null };
}
