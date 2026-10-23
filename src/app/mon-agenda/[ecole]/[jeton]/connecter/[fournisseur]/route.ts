import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  pkceChallenge,
  PROVIDERS,
  type Provider,
  credentials,
  signState,
  authorizationUrl,
} from "@/connectors/calendar/oauth";
import { withSchool } from "@/db";
import { tokenInstructor } from "@/db/calendar";
import { COOKIE_OAUTH, personalPage, redirectionOAuth } from "@/lib/public-calendar";

/**
 * Départ vers Google ou Microsoft depuis la page personnelle d'un intervenant.
 * Le vérificateur PKCE et l'adresse de retour restent dans un cookie httpOnly ;
 * l'état signé lie la réponse à cet intervenant et à cette école.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/mon-agenda/[ecole]/[jeton]/connecter/[fournisseur]">) {
  const { ecole, jeton, fournisseur } = await ctx.params;
  const notFound = new Response("Lien introuvable ou révoqué.", { status: 404 });
  if (!z.uuid().safeParse(ecole).success || !PROVIDERS.includes(fournisseur as Provider)) return notFound;
  const f = fournisseur as Provider;
  const id = credentials(f);
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!id || !secret) return new Response("Connexion à ce fournisseur non configurée.", { status: 503 });

  const instructor = await withSchool(ecole, (tx) => tokenInstructor(tx, jeton));
  if (!instructor) return notFound;

  const { verifier: verifier, challenge: challenge } = pkceChallenge();
  const nonce = randomBytes(16).toString("base64url");
  const state = signState({ schoolId: ecole, instructorId: instructor.id, provider: f, nonce }, secret);
  const response = Response.redirect(
    authorizationUrl(f, id.identifier, { redirection: redirectionOAuth(f), state, challenge: challenge }),
    302,
  );
  const cookie = Buffer.from(JSON.stringify({ verifier: verifier, nonce, back: personalPage(ecole, jeton) })).toString(
    "base64url",
  );
  const secured = redirectionOAuth(f).startsWith("https:") ? "; Secure" : "";
  const requestHeaders = new Headers(response.headers);
  requestHeaders.append(
    "Set-Cookie",
    `${COOKIE_OAUTH}=${cookie}; Path=/api/agenda; HttpOnly; SameSite=Lax; Max-Age=600${secured}`,
  );
  return new Response(null, { status: 302, headers: requestHeaders });
}
