import type { NextRequest } from "next/server";
import { z } from "zod";
import { echangerCode, FOURNISSEURS, type Fournisseur, identifiants, verifierEtat } from "@/connecteurs/agenda/oauth";
import { avecEcole } from "@/db";
import { enregistrerConnexion } from "@/db/connexions-agenda";
import { chiffrer } from "@/lib/chiffrement";
import { adressePublique, COOKIE_OAUTH, redirectionOAuth } from "@/lib/agenda-public";
import { synchroniserAgenda } from "@/lib/synchro-agenda";

/**
 * Retour de Google ou Microsoft : vérifie l'état signé et le cookie du départ,
 * échange le code (PKCE), chiffre l'accès durable, synchronise une première
 * fois, puis renvoie l'intervenant sur sa page personnelle.
 */
const cookieOAuth = z.object({ verificateur: z.string(), nonce: z.string(), retour: z.string() });

export async function GET(req: NextRequest, ctx: RouteContext<"/api/agenda/retour/[fournisseur]">) {
  const { fournisseur } = await ctx.params;
  const parametres = req.nextUrl.searchParams;
  const brut = req.cookies.get(COOKIE_OAUTH)?.value;
  let cookie: z.infer<typeof cookieOAuth> | null = null;
  try {
    // The cookie comes from the browser: its shape is checked, never trusted.
    cookie = brut ? cookieOAuth.parse(JSON.parse(Buffer.from(brut, "base64url").toString("utf8"))) : null;
  } catch {
    cookie = null;
  }
  const retour = (statut: string) => {
    const destination = cookie?.retour?.startsWith("/mon-agenda/") ? cookie.retour : "/";
    const entetes = new Headers({ Location: `${adressePublique()}${destination}?agenda=${statut}` });
    entetes.append("Set-Cookie", `${COOKIE_OAUTH}=; Path=/api/agenda; HttpOnly; SameSite=Lax; Max-Age=0`);
    return new Response(null, { status: 302, headers: entetes });
  };

  if (!FOURNISSEURS.includes(fournisseur as Fournisseur) || !cookie) return retour("erreur");
  const f = fournisseur as Fournisseur;
  if (parametres.get("error")) return retour("refuse");
  const etat = verifierEtat(parametres.get("state") ?? "", process.env.BETTER_AUTH_SECRET ?? "");
  const code = parametres.get("code");
  const id = identifiants(f);
  if (!etat || etat.fournisseur !== f || etat.nonce !== cookie.nonce || !code || !id) return retour("erreur");

  try {
    const { jetonRafraichissement, compte } = await echangerCode(f, id, {
      code,
      verificateur: cookie.verificateur,
      redirection: redirectionOAuth(f),
    });
    // L'intervenant a pu être désactivé entre le départ et le retour : rien n'est alors enregistré.
    const enregistre = await avecEcole(etat.ecoleId, (tx) =>
      enregistrerConnexion(tx, etat.intervenantId, {
        fournisseur: f,
        compte,
        jetonChiffre: chiffrer(jetonRafraichissement),
      }),
    );
    if (!enregistre) return retour("erreur");
  } catch {
    return retour("erreur");
  }
  await synchroniserAgenda(etat.ecoleId, etat.intervenantId);
  return retour("connecte");
}
