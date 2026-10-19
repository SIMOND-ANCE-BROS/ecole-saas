"use server";

import { redirect } from "next/navigation";
import { choisirEcole } from "@/lib/acces-ecole";
import { sessionCourante } from "@/lib/session";

/** L'école proposée par le formulaire n'est retenue que si l'utilisateur en est membre actif. */
export async function choisirEcoleAction(formData: FormData) {
  const { session, user } = await sessionCourante();
  const retenue = await choisirEcole(session.id, user.id, String(formData.get("ecoleId") ?? ""));
  redirect(retenue ? "/" : "/ecoles");
}
