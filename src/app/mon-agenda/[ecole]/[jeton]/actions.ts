"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { avecEcole } from "@/db";
import { intervenantDuJeton } from "@/db/agenda";
import { supprimerConnexion } from "@/db/connexions-agenda";
import { pagePersonnelle } from "@/lib/agenda-public";

/** Déconnexion par l'intervenant lui-même : son lien personnel fait foi. */
export async function deconnecterMonAgenda(ecoleId: string, jeton: string): Promise<{ message: string | null }> {
  if (!z.uuid().safeParse(ecoleId).success) return { message: "Lien introuvable ou révoqué." };
  const ok = await avecEcole(ecoleId, async (tx) => {
    const i = await intervenantDuJeton(tx, jeton);
    return i ? supprimerConnexion(tx, i.id) : false;
  });
  revalidatePath(pagePersonnelle(ecoleId, jeton));
  return { message: ok ? null : "Aucun agenda connecté." };
}
