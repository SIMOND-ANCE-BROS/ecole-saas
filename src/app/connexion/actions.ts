"use server";

import { SIGN_IN } from "./fields";
import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { schoolsOf } from "@/db";
import { chooseSchool, sessionIdOf } from "@/lib/school-access";
import { auth } from "@/lib/auth";
import { credentialBefore, dropSession, keepSessionIfPasswordUnchanged } from "@/lib/sign-in-guard";
import { clearAttempts, recordAttempt, trustedIp, LIMITS } from "@/lib/sign-in-limit";

/** Same message for an unknown account, a wrong password, or one changed while being checked. */
const WRONG = "Adresse e-mail ou mot de passe incorrect.";

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

  // Read before the password check: a take-back committing meanwhile closes the session (#404).
  const before = await credentialBefore(parsed.data.email);
  let connection;
  try {
    connection = await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: requestHeaders,
    });
  } catch (e) {
    if (isAPIError(e)) return { error: WRONG, email };
    throw e;
  }
  // The password changed while it was being checked: the one typed is no longer the account's.
  // A guard that fails keeps nothing either: the session is closed, the person signs in again.
  const kept = await keepSessionIfPasswordUnchanged(connection.token, connection.user.id, before).catch(
    async (e: unknown) => {
      await dropSession(connection.token).catch(() => {});
      throw e;
    },
  );
  if (!kept) return { error: WRONG, email };
  await clearAttempts(parsed.data.email, ip);

  // A single school: chosen automatically, without going through the list.
  const schools = await schoolsOf(connection.user.id);
  const sessionId = await sessionIdOf(connection.token);
  if (schools.length === 1 && sessionId && (await chooseSchool(sessionId, connection.user.id, schools[0].id))) {
    redirect("/");
  }
  redirect("/ecoles");
}
