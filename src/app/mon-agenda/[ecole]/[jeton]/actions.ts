"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSchool } from "@/db";
import { tokenInstructor } from "@/db/agenda";
import { deleteConnection } from "@/db/connexions-agenda";
import { personalPage } from "@/lib/agenda-public";

/** Déconnexion par l'intervenant lui-même : son lien personnel fait foi. */
export async function disconnectMyCalendar(schoolId: string, token: string): Promise<{ message: string | null }> {
  if (!z.uuid().safeParse(schoolId).success) return { message: "Lien introuvable ou révoqué." };
  const ok = await withSchool(schoolId, async (tx) => {
    const i = await tokenInstructor(tx, token);
    return i ? deleteConnection(tx, i.id) : false;
  });
  revalidatePath(personalPage(schoolId, token));
  return { message: ok ? null : "Aucun agenda connecté." };
}
