import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  defiPkce,
  FOURNISSEURS,
  type Fournisseur,
  identifiants,
  signerEtat,
  urlAutorisation,
} from "@/connecteurs/agenda/oauth";
import { avecEcole } from "@/db";
import { intervenantDuJeton } from "@/db/agenda";
import { COOKIE_OAUTH, pagePersonnelle, redirectionOAuth } from "@/lib/agenda-public";

/**
 * Départ vers Google ou Microsoft depuis la page personnelle d'un intervenant.
 * Le vérificateur PKCE et l'adresse de retour restent dans un cookie httpOnly ;
 * l'état signé lie la réponse à cet intervenant et à cette école.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/mon-agenda/[ecole]/[jeton]/connecter/[fournisseur]">) {
  const { ecole, jeton, fournisseur } = await ctx.params;
  const introuvable = new Response("Lien introuvable ou révoqué.", { status: 404 });
  if (!z.uuid().safeParse(ecole).success || !FOURNISSEURS.includes(fournisseur as Fournisseur)) return introuvable;
  const f = fournisseur as Fournisseur;
  const id = identifiants(f);
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!id || !secret) return new Response("Connexion à ce fournisseur non configurée.", { status: 503 });

  const intervenant = await avecEcole(ecole, (tx) => intervenantDuJeton(tx, jeton));
  if (!intervenant) return introuvable;

  const { verificateur, defi } = defiPkce();
  const nonce = randomBytes(16).toString("base64url");
  const etat = signerEtat({ ecoleId: ecole, intervenantId: intervenant.id, fournisseur: f, nonce }, secret);
  const reponse = Response.redirect(
    urlAutorisation(f, id.identifiant, { redirection: redirectionOAuth(f), etat, defi }),
    302,
  );
  const cookie = Buffer.from(JSON.stringify({ verificateur, nonce, retour: pagePersonnelle(ecole, jeton) })).toString(
    "base64url",
  );
  const securise = redirectionOAuth(f).startsWith("https:") ? "; Secure" : "";
  const entetes = new Headers(reponse.headers);
  entetes.append(
    "Set-Cookie",
    `${COOKIE_OAUTH}=${cookie}; Path=/api/agenda; HttpOnly; SameSite=Lax; Max-Age=600${securise}`,
  );
  return new Response(null, { status: 302, headers: entetes });
}
