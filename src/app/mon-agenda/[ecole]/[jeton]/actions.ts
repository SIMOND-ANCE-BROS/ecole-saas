"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSchool } from "@/db";
import { tokenInstructor } from "@/db/calendar-feed";
import { deleteConnection } from "@/db/calendar-connections";
import { personalPage } from "@/lib/public-calendar";

/** Disconnection by the instructor themself: their personal link is the proof. */
export async function disconnectMyCalendar(schoolId: string, token: string): Promise<{ message: string | null }> {
  if (!z.uuid().safeParse(schoolId).success) return { message: "Lien introuvable ou révoqué." };
  const ok = await withSchool(schoolId, async (tx) => {
    const i = await tokenInstructor(tx, token);
    return i ? deleteConnection(tx, i.id) : false;
  });
  revalidatePath(personalPage(schoolId, token));
  return { message: ok ? null : "Aucun agenda connecté." };
}
