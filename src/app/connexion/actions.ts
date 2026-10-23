"use server";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { schoolsOf } from "@/db";
import { chooseSchool, idDeSession } from "@/lib/school-access";
import { auth } from "@/lib/auth";
import { clearAttempts, recordAttempt, trustedIp, LIMITES } from "@/lib/sign-in-limit";

export type ConnectionState = { error: string | null; email: string };

const saisie = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function signIn(_etat: ConnectionState, formData: FormData): Promise<ConnectionState> {
  const email = String(formData.get("email") ?? "");
  const donnees = saisie.safeParse({ email, password: formData.get("password") });
  if (!donnees.success) {
    return { error: "Saisissez une adresse e-mail valide et votre mot de passe.", email };
  }

  const requestHeaders = await headers();
  // Tentative enregistrée avant la vérification du mot de passe (voir limite-connexion.ts).
  const ip = trustedIp(requestHeaders);
  if (!(await recordAttempt(donnees.data.email, ip))) {
    return {
      error: `Trop de tentatives de connexion. Réessayez dans ${LIMITES.windowMinutes} minutes.`,
      email,
    };
  }

  let connection;
  try {
    connection = await auth.api.signInEmail({
      body: { email: donnees.data.email, password: donnees.data.password },
      headers: requestHeaders,
    });
  } catch (e) {
    // Même message pour un compte inconnu ou un mauvais mot de passe.
    if (isAPIError(e)) return { error: "Adresse e-mail ou mot de passe incorrect.", email };
    throw e;
  }
  await clearAttempts(donnees.data.email, ip);

  // Une seule école : choisie d'office, sans passer par la liste.
  const ecoles = await schoolsOf(connection.user.id);
  const sessionId = await idDeSession(connection.token);
  if (ecoles.length === 1 && sessionId && (await chooseSchool(sessionId, connection.user.id, ecoles[0].id))) {
    redirect("/");
  }
  redirect("/ecoles");
}
