"use server";

import { z } from "zod";
import { withSchool } from "@/db";
import { savePreference } from "@/db/preferences";
import { LISTES } from "@/domaine/filtres/colonnes";
import { writeLayout, readLayout } from "@/domaine/filtres/disposition";
import { schoolContext } from "@/lib/session";

const saisie = z.object({
  list: z.enum(Object.keys(LISTES) as [keyof typeof LISTES, ...(keyof typeof LISTES)[]]),
  columns: z.array(z.string().max(40)).max(40),
});

/** Mémorise l'ordre et la visibilité des colonnes d'une liste pour le membre connecté (#89). */
export async function saveColumns(list: unknown, columns: unknown): Promise<boolean> {
  const { schoolId: schoolId, userId } = await schoolContext();
  const v = saisie.safeParse({ list: list, columns: columns });
  if (!v.success) return false;
  // Normalisée : colonnes connues seulement, au moins une visible.
  const own = writeLayout(readLayout(LISTES[v.data.list], v.data.columns));
  return withSchool(schoolId, (tx) => savePreference(tx, userId, v.data.list, own));
}
