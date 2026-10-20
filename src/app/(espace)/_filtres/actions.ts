"use server";

import { z } from "zod";
import { avecEcole } from "@/db";
import { enregistrerPreference } from "@/db/preferences";
import { LISTES } from "@/domaine/filtres/colonnes";
import { ecrireDisposition, lireDisposition } from "@/domaine/filtres/disposition";
import { contexteEcole } from "@/lib/session";

const saisie = z.object({
  liste: z.enum(Object.keys(LISTES) as [keyof typeof LISTES, ...(keyof typeof LISTES)[]]),
  colonnes: z.array(z.string().max(40)).max(40),
});

/** Mémorise l'ordre et la visibilité des colonnes d'une liste pour le membre connecté (#89). */
export async function enregistrerColonnes(liste: unknown, colonnes: unknown): Promise<boolean> {
  const { ecoleId, userId } = await contexteEcole();
  const v = saisie.safeParse({ liste, colonnes });
  if (!v.success) return false;
  // Normalisée : colonnes connues seulement, au moins une visible.
  const propre = ecrireDisposition(lireDisposition(LISTES[v.data.liste], v.data.colonnes));
  return avecEcole(ecoleId, (tx) => enregistrerPreference(tx, userId, v.data.liste, propre));
}
