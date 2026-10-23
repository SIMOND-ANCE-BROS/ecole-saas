"use server";

import { redirect } from "next/navigation";
import { chooseSchool } from "@/lib/acces-ecole";
import { currentSession } from "@/lib/session";

/** L'école proposée par le formulaire n'est retenue que si l'utilisateur en est membre actif. */
export async function chooseSchoolAction(formData: FormData) {
  const { session, user } = await currentSession();
  const retained = await chooseSchool(session.id, user.id, String(formData.get("schoolId") ?? ""));
  redirect(retained ? "/" : "/ecoles");
}
