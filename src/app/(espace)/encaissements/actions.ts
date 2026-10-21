"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import { annulerRemise, creerRemise } from "@/db/remises";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";

/** Crée une remise (accueil et direction) puis ouvre son bordereau. */
export async function remettre(saisie: unknown): Promise<{ message: string }> {
  const { ecoleId, userId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => creerRemise(tx, userId, saisie as never, aujourdhuiAParis()));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect(`/encaissements/remises/${r.id}?cree=1`);
}

/** Annule une remise faite par erreur : direction seulement. */
export async function annuler(id: string): Promise<{ message: string }> {
  const { ecoleId, userId } = await exigerRole("direction");
  const r = await avecEcole(ecoleId, (tx) => annulerRemise(tx, userId, id));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect("/encaissements?vue=remettre&annulee=1");
}
