import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Connexion aux agendas Google et Microsoft des intervenants (OAuth 2 avec
 * PKCE) et lecture des seules plages occupées. Une application par
 * fournisseur, tenue par l'éditeur pour toutes les écoles ; identifiants en
 * variables d'environnement. `fetch` est injecté pour les tests.
 */

export type Fournisseur = "google" | "microsoft";
export const FOURNISSEURS: Fournisseur[] = ["google", "microsoft"];
export const NOM_FOURNISSEUR: Record<Fournisseur, string> = {
  google: "Google Agenda",
  microsoft: "Microsoft (Outlook)",
};

type Point = {
  autorisation: string;
  jeton: string;
  portees: string;
  parametres: Record<string, string>;
  variables: [identifiant: string, secret: string];
};

const POINTS: Record<Fournisseur, Point> = {
  google: {
    autorisation: "https://accounts.google.com/o/oauth2/v2/auth",
    jeton: "https://oauth2.googleapis.com/token",
    // Disponibilités seulement : ni titre, ni lieu, ni participants.
    portees: "openid email https://www.googleapis.com/auth/calendar.freebusy",
    parametres: { access_type: "offline", prompt: "consent" },
    variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  microsoft: {
    autorisation: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    jeton: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // Lecture de base : horaires et disponibilité, sans le corps des événements.
    portees: "openid email offline_access Calendars.ReadBasic",
    parametres: { prompt: "select_account" },
    variables: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  },
};

export type Identifiants = { identifiant: string; secret: string };

/** Identifiants de l'application chez le fournisseur ; null s'il n'est pas configuré. */
export function identifiants(
  f: Fournisseur,
  env: Record<string, string | undefined> = process.env,
): Identifiants | null {
  const [i, s] = POINTS[f].variables;
  return env[i] && env[s] ? { identifiant: env[i] as string, secret: env[s] as string } : null;
}

export function defiPkce(): { verificateur: string; defi: string } {
  const verificateur = randomBytes(32).toString("base64url");
  return { verificateur, defi: createHash("sha256").update(verificateur).digest("base64url") };
}

export function urlAutorisation(
  f: Fournisseur,
  identifiant: string,
  o: { redirection: string; etat: string; defi: string },
): string {
  const p = POINTS[f];
  const url = new URL(p.autorisation);
  for (const [cle, valeur] of Object.entries({
    client_id: identifiant,
    redirect_uri: o.redirection,
    response_type: "code",
    scope: p.portees,
    state: o.etat,
    code_challenge: o.defi,
    code_challenge_method: "S256",
    ...p.parametres,
  }))
    url.searchParams.set(cle, valeur);
  return url.toString();
}

// ---------------------------------------------------------------------------
// État signé (CSRF) : qui se connecte, auprès de quel fournisseur, jusqu'à quand.
// ---------------------------------------------------------------------------

export type Etat = { ecoleId: string; intervenantId: string; fournisseur: Fournisseur; nonce: string; expire: number };
const DUREE_ETAT = 10 * 60_000;

const signature = (charge: string, secret: string) =>
  createHmac("sha256", `etat-agenda:${secret}`).update(charge).digest("base64url");

export function signerEtat(e: Omit<Etat, "expire">, secret: string, maintenant = Date.now()): string {
  const charge = Buffer.from(JSON.stringify({ ...e, expire: maintenant + DUREE_ETAT })).toString("base64url");
  return `${charge}.${signature(charge, secret)}`;
}

export function verifierEtat(etat: string, secret: string, maintenant = Date.now()): Etat | null {
  const [charge, sig] = etat.split(".");
  if (!charge || !sig) return null;
  const attendue = Buffer.from(signature(charge, secret));
  const recue = Buffer.from(sig);
  if (attendue.length !== recue.length || !timingSafeEqual(attendue, recue)) return null;
  try {
    const e = JSON.parse(Buffer.from(charge, "base64url").toString("utf8")) as Etat;
    return e.expire > maintenant && FOURNISSEURS.includes(e.fournisseur) ? e : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------

type Fetch = typeof fetch;
export class AccesRetire extends Error {}

async function demanderJeton(f: Fournisseur, id: Identifiants, corps: Record<string, string>, requete: Fetch) {
  const reponse = await requete(POINTS[f].jeton, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id.identifiant, client_secret: id.secret, ...corps }),
  });
  const json = (await reponse.json()) as Record<string, string | undefined>;
  if (!reponse.ok) {
    // invalid_grant : l'intervenant a retiré l'accès, ou le jeton a expiré.
    if (json.error === "invalid_grant")
      throw new AccesRetire("Accès à l’agenda retiré ou expiré : reconnecter l’agenda.");
    throw new Error(`Réponse ${reponse.status} du fournisseur (${json.error ?? "erreur inconnue"})`);
  }
  return json;
}

/** Adresse du compte, lue dans le jeton d'identité reçu directement du fournisseur. */
function compteDuJeton(idToken: string | undefined): string | null {
  const charge = idToken?.split(".")[1];
  if (!charge) return null;
  try {
    const c = JSON.parse(Buffer.from(charge, "base64url").toString("utf8")) as {
      email?: string;
      preferred_username?: string;
    };
    return c.email ?? c.preferred_username ?? null;
  } catch {
    return null;
  }
}

export async function echangerCode(
  f: Fournisseur,
  id: Identifiants,
  o: { code: string; verificateur: string; redirection: string },
  requete: Fetch = fetch,
): Promise<{ jetonRafraichissement: string; compte: string | null }> {
  const json = await demanderJeton(
    f,
    id,
    { grant_type: "authorization_code", code: o.code, code_verifier: o.verificateur, redirect_uri: o.redirection },
    requete,
  );
  if (!json.refresh_token) throw new Error("Le fournisseur n’a pas donné d’accès durable (refresh_token absent).");
  return { jetonRafraichissement: json.refresh_token, compte: compteDuJeton(json.id_token) };
}

/** Jeton d'accès frais ; Microsoft peut aussi renvoyer un nouveau jeton de rafraîchissement. */
export async function rafraichir(
  f: Fournisseur,
  id: Identifiants,
  jetonRafraichissement: string,
  requete: Fetch = fetch,
): Promise<{ acces: string; nouveauRafraichissement: string | null }> {
  const json = await demanderJeton(
    f,
    id,
    { grant_type: "refresh_token", refresh_token: jetonRafraichissement },
    requete,
  );
  if (!json.access_token) throw new Error("Jeton d’accès absent de la réponse.");
  return { acces: json.access_token, nouveauRafraichissement: json.refresh_token ?? null };
}

// ---------------------------------------------------------------------------
// Plages occupées
// ---------------------------------------------------------------------------

export type Plage = { debut: Date; fin: Date };

/** Réponse de l'API free/busy de Google (agenda principal). */
export function plagesGoogle(json: unknown): Plage[] {
  const busy =
    (json as { calendars?: { primary?: { busy?: { start: string; end: string }[] } } }).calendars?.primary?.busy ?? [];
  return busy.map((b) => ({ debut: new Date(b.start), fin: new Date(b.end) })).filter((p) => p.fin > p.debut);
}

type EvenementMicrosoft = {
  start: { dateTime: string };
  end: { dateTime: string };
  showAs?: string;
  isCancelled?: boolean;
};
const OCCUPE_MICROSOFT = new Set(["busy", "oof", "tentative", "workingElsewhere"]);
/** Heure UTC de Microsoft Graph (demandée par l'en-tête Prefer), sans suffixe. */
const utcMicrosoft = (t: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`);

/** Événements de calendarView ; seuls les occupés (pas « libre ») et non annulés comptent. */
export function plagesMicrosoft(json: unknown): Plage[] {
  const evenements = (json as { value?: EvenementMicrosoft[] }).value ?? [];
  return evenements
    .filter((e) => !e.isCancelled && OCCUPE_MICROSOFT.has(e.showAs ?? "busy"))
    .map((e) => ({ debut: utcMicrosoft(e.start.dateTime), fin: utcMicrosoft(e.end.dateTime) }))
    .filter((p) => p.fin > p.debut);
}

export async function lirePlagesOccupees(
  f: Fournisseur,
  acces: string,
  fenetre: Plage,
  requete: Fetch = fetch,
): Promise<Plage[]> {
  const entetes = { Authorization: `Bearer ${acces}` };
  if (f === "google") {
    const reponse = await requete("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { ...entetes, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: fenetre.debut.toISOString(),
        timeMax: fenetre.fin.toISOString(),
        items: [{ id: "primary" }],
      }),
    });
    if (!reponse.ok) throw new Error(`Google free/busy : réponse ${reponse.status}`);
    return plagesGoogle(await reponse.json());
  }
  const plages: Plage[] = [];
  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${fenetre.debut.toISOString()}&endDateTime=${fenetre.fin.toISOString()}` +
    "&$select=start,end,showAs,isCancelled&$top=200";
  for (let pages = 0; url && pages < 20; pages++) {
    const reponse: Response = await requete(url, { headers: { ...entetes, Prefer: 'outlook.timezone="UTC"' } });
    if (!reponse.ok) throw new Error(`Microsoft calendarView : réponse ${reponse.status}`);
    const json = (await reponse.json()) as { "@odata.nextLink"?: string };
    plages.push(...plagesMicrosoft(json));
    url = json["@odata.nextLink"];
  }
  return plages;
}
