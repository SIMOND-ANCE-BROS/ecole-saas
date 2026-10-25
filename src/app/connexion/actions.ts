"use server";

import { SIGN_IN } from "./fields";
import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { schoolsOf } from "@/db";
import { chooseSchool, idDeSession } from "@/lib/school-access";
import { auth } from "@/lib/auth";
import { clearAttempts, recordAttempt, trustedIp, LIMITS } from "@/lib/sign-in-limit";

export type ConnectionState = { error: string | null; email: string };

const entry = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function signIn(_state: ConnectionState, formData: FormData): Promise<ConnectionState> {
  const email = SIGN_IN.read(formData, "email");
  const parsed = entry.safeParse({ email, password: SIGN_IN.read(formData, "password") });
  if (!parsed.success) {
    return { error: "Saisissez une adresse e-mail valide et votre mot de passe.", email };
  }

  const requestHeaders = await headers();
  // Attempt recorded before the password check (see sign-in-limit.ts).
  const ip = trustedIp(requestHeaders);
  if (!(await recordAttempt(parsed.data.email, ip))) {
    return {
      error: `Trop de tentatives de connexion. Réessayez dans ${LIMITS.windowMinutes} minutes.`,
      email,
    };
  }

  let connection;
  try {
    connection = await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: requestHeaders,
    });
  } catch (e) {
    // Same message for an unknown account or a wrong password.
    if (isAPIError(e)) return { error: "Adresse e-mail ou mot de passe incorrect.", email };
    throw e;
  }
  await clearAttempts(parsed.data.email, ip);

  // A single school: chosen automatically, without going through the list.
  const schools = await schoolsOf(connection.user.id);
  const sessionId = await idDeSession(connection.token);
  if (schools.length === 1 && sessionId && (await chooseSchool(sessionId, connection.user.id, schools[0].id))) {
    redirect("/");
  }
  redirect("/ecoles");
}
