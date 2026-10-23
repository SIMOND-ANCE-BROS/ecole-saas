import type { NextRequest } from "next/server";
import { z } from "zod";
import { exchangeCode, PROVIDERS, type Provider, credentials, verifyState } from "@/connectors/calendar/oauth";
import { withSchool } from "@/db";
import { saveConnection } from "@/db/calendar-connections";
import { encrypt } from "@/lib/encryption";
import { publicAddress, COOKIE_OAUTH, redirectionOAuth } from "@/lib/public-calendar";
import { syncCalendar } from "@/lib/calendar-sync";

/**
 * Retour de Google ou Microsoft : vérifie l'état signé et le cookie du départ,
 * échange le code (PKCE), chiffre l'accès durable, synchronise une première
 * fois, puis renvoie l'intervenant sur sa page personnelle.
 */
const cookieOAuth = z.object({ verifier: z.string(), nonce: z.string(), back: z.string() });

export async function GET(req: NextRequest, ctx: RouteContext<"/api/agenda/retour/[fournisseur]">) {
  const { fournisseur } = await ctx.params;
  const settings = req.nextUrl.searchParams;
  const raw = req.cookies.get(COOKIE_OAUTH)?.value;
  let cookie: z.infer<typeof cookieOAuth> | null = null;
  try {
    // The cookie comes from the browser: its shape is checked, never trusted.
    cookie = raw ? cookieOAuth.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))) : null;
  } catch {
    cookie = null;
  }
  const back = (status: string) => {
    const destination = cookie?.back?.startsWith("/mon-agenda/") ? cookie.back : "/";
    const requestHeaders = new Headers({ Location: `${publicAddress()}${destination}?agenda=${status}` });
    requestHeaders.append("Set-Cookie", `${COOKIE_OAUTH}=; Path=/api/agenda; HttpOnly; SameSite=Lax; Max-Age=0`);
    return new Response(null, { status: 302, headers: requestHeaders });
  };

  if (!PROVIDERS.includes(fournisseur as Provider) || !cookie) return back("erreur");
  const f = fournisseur as Provider;
  if (settings.get("error")) return back("refuse");
  const state = verifyState(settings.get("state") ?? "", process.env.BETTER_AUTH_SECRET ?? "");
  const code = settings.get("code");
  const id = credentials(f);
  if (!state || state.provider !== f || state.nonce !== cookie.nonce || !code || !id) return back("erreur");

  try {
    const { refreshToken: refreshToken, account: account } = await exchangeCode(f, id, {
      code,
      verifier: cookie.verifier,
      redirection: redirectionOAuth(f),
    });
    // L'intervenant a pu être désactivé entre le départ et le retour : rien n'est alors enregistré.
    const saves = await withSchool(state.schoolId, (tx) =>
      saveConnection(tx, state.instructorId, {
        provider: f,
        account: account,
        encryptedToken: encrypt(refreshToken),
      }),
    );
    if (!saves) return back("erreur");
  } catch {
    return back("erreur");
  }
  await syncCalendar(state.schoolId, state.instructorId);
  return back("connecte");
}
