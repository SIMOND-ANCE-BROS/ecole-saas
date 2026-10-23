import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Connexion aux agendas Google et Microsoft des intervenants (OAuth 2 avec
 * PKCE) et lecture des seules plages occupées. Une application par
 * fournisseur, tenue par l'éditeur pour toutes les écoles ; identifiants en
 * variables d'environnement. `fetch` est injecté pour les tests.
 */

export type Provider = "google" | "microsoft";
export const PROVIDERS: Provider[] = ["google", "microsoft"];
export const PROVIDER_NAME: Record<Provider, string> = {
  google: "Google Agenda",
  microsoft: "Microsoft (Outlook)",
};

type Point = {
  authorization: string;
  token: string;
  scopes: string;
  settings: Record<string, string>;
  variables: [identifiant: string, secret: string];
};

const POINTS: Record<Provider, Point> = {
  google: {
    authorization: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    // Disponibilités seulement : ni titre, ni lieu, ni participants.
    scopes: "openid email https://www.googleapis.com/auth/calendar.freebusy",
    settings: { access_type: "offline", prompt: "consent" },
    variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  microsoft: {
    authorization: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // Lecture de base : horaires et disponibilité, sans le corps des événements.
    scopes: "openid email offline_access Calendars.ReadBasic",
    settings: { prompt: "select_account" },
    variables: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  },
};

export type Credentials = { identifier: string; secret: string };

/** Identifiants de l'application chez le fournisseur ; null s'il n'est pas configuré. */
export function credentials(f: Provider, env: Record<string, string | undefined> = process.env): Credentials | null {
  const [i, s] = POINTS[f].variables;
  return env[i] && env[s] ? { identifier: env[i] as string, secret: env[s] as string } : null;
}

export function pkceChallenge(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizationUrl(
  f: Provider,
  identifier: string,
  o: { redirection: string; state: string; challenge: string },
): string {
  const p = POINTS[f];
  const url = new URL(p.authorization);
  for (const [key, value] of Object.entries({
    client_id: identifier,
    redirect_uri: o.redirection,
    response_type: "code",
    scope: p.scopes,
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    ...p.settings,
  }))
    url.searchParams.set(key, value);
  return url.toString();
}

// ---------------------------------------------------------------------------
// État signé (CSRF) : qui se connecte, auprès de quel fournisseur, jusqu'à quand.
// ---------------------------------------------------------------------------

export type State = { schoolId: string; instructorId: string; provider: Provider; nonce: string; expiresAt: number };
const STATE_DURATION = 10 * 60_000;

const signature = (payload: string, secret: string) =>
  createHmac("sha256", `etat-agenda:${secret}`).update(payload).digest("base64url");

export function signState(e: Omit<State, "expiresAt">, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...e, expiresAt: now + STATE_DURATION })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyState(state: string, secret: string, now = Date.now()): State | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(signature(payload, secret));
  const received = Buffer.from(sig);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const e = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as State;
    return e.expiresAt > now && PROVIDERS.includes(e.provider) ? e : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------

type Fetch = typeof fetch;
export class AccessRemoved extends Error {}

async function requestToken(f: Provider, id: Credentials, body: Record<string, string>, query: Fetch) {
  const response = await query(POINTS[f].token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id.identifier, client_secret: id.secret, ...body }),
  });
  const json = (await response.json()) as Record<string, string | undefined>;
  if (!response.ok) {
    // invalid_grant : l'intervenant a retiré l'accès, ou le jeton a expiré.
    if (json.error === "invalid_grant")
      throw new AccessRemoved("Accès à l’agenda retiré ou expiré : reconnecter l’agenda.");
    throw new Error(`Réponse ${response.status} du fournisseur (${json.error ?? "erreur inconnue"})`);
  }
  return json;
}

/** Adresse du compte, lue dans le jeton d'identité reçu directement du fournisseur. */
function tokenAccount(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      preferred_username?: string;
    };
    return c.email ?? c.preferred_username ?? null;
  } catch {
    return null;
  }
}

export async function exchangeCode(
  f: Provider,
  id: Credentials,
  o: { code: string; verifier: string; redirection: string },
  query: Fetch = fetch,
): Promise<{ refreshToken: string; account: string | null }> {
  const json = await requestToken(
    f,
    id,
    { grant_type: "authorization_code", code: o.code, code_verifier: o.verifier, redirect_uri: o.redirection },
    query,
  );
  if (!json.refresh_token) throw new Error("Le fournisseur n’a pas donné d’accès durable (refresh_token absent).");
  return { refreshToken: json.refresh_token, account: tokenAccount(json.id_token) };
}

/** Jeton d'accès frais ; Microsoft peut aussi renvoyer un nouveau jeton de rafraîchissement. */
export async function refresh(
  f: Provider,
  id: Credentials,
  refreshToken: string,
  query: Fetch = fetch,
): Promise<{ access: string; newRefreshToken: string | null }> {
  const json = await requestToken(f, id, { grant_type: "refresh_token", refresh_token: refreshToken }, query);
  if (!json.access_token) throw new Error("Jeton d’accès absent de la réponse.");
  return { access: json.access_token, newRefreshToken: json.refresh_token ?? null };
}

// ---------------------------------------------------------------------------
// Plages occupées
// ---------------------------------------------------------------------------

export type Range = { start: Date; end: Date };

/** Réponse de l'API free/busy de Google (agenda principal). */
export function googleRanges(json: unknown): Range[] {
  const busy =
    (json as { calendars?: { primary?: { busy?: { start: string; end: string }[] } } }).calendars?.primary?.busy ?? [];
  return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })).filter((p) => p.end > p.start);
}

type MicrosoftEvent = {
  start: { dateTime: string };
  end: { dateTime: string };
  showAs?: string;
  isCancelled?: boolean;
};
const MICROSOFT_BUSY = new Set(["busy", "oof", "tentative", "workingElsewhere"]);
/** Heure UTC de Microsoft Graph (demandée par l'en-tête Prefer), sans suffixe. */
const utcMicrosoft = (t: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`);

/** Événements de calendarView ; seuls les occupés (pas « libre ») et non annulés comptent. */
export function microsoftRanges(json: unknown): Range[] {
  const events = (json as { value?: MicrosoftEvent[] }).value ?? [];
  return events
    .filter((e) => !e.isCancelled && MICROSOFT_BUSY.has(e.showAs ?? "busy"))
    .map((e) => ({ start: utcMicrosoft(e.start.dateTime), end: utcMicrosoft(e.end.dateTime) }))
    .filter((p) => p.end > p.start);
}

export async function readBusyRanges(
  f: Provider,
  access: string,
  window: Range,
  query: Fetch = fetch,
): Promise<Range[]> {
  const requestHeaders = { Authorization: `Bearer ${access}` };
  if (f === "google") {
    const response = await query("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: window.start.toISOString(),
        timeMax: window.end.toISOString(),
        items: [{ id: "primary" }],
      }),
    });
    if (!response.ok) throw new Error(`Google free/busy : réponse ${response.status}`);
    return googleRanges(await response.json());
  }
  const ranges: Range[] = [];
  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${window.start.toISOString()}&endDateTime=${window.end.toISOString()}` +
    "&$select=start,end,showAs,isCancelled&$top=200";
  for (let pages = 0; url && pages < 20; pages++) {
    const response: Response = await query(url, { headers: { ...requestHeaders, Prefer: 'outlook.timezone="UTC"' } });
    if (!response.ok) throw new Error(`Microsoft calendarView : réponse ${response.status}`);
    const json = (await response.json()) as { "@odata.nextLink"?: string };
    ranges.push(...microsoftRanges(json));
    url = json["@odata.nextLink"];
  }
  return ranges;
}
