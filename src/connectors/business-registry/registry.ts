import { z } from "zod";

/**
 * French business registry (#207): the State's public API « Recherche
 * d’entreprises » (annuaire-entreprises.data.gouv.fr), no key, about seven
 * calls per second per server. Searched by name, SIREN or SIRET to fill an
 * organisation or an instructor's business. `fetch` is injected for tests.
 */

const URL_SEARCH = "https://recherche-entreprises.api.gouv.fr/search";
const TIMEOUT_MS = 4000;
const RESULTS = 8;

export type Business = {
  legalName: string;
  siren: string;
  /** Head office. */
  siret: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  legalForm: string | null;
  /** Closed company (« cessée »): still shown, flagged. */
  ceased: boolean;
};

/** The registry did not answer usably (timeout, refusal, unexpected response). */
export class RegistryUnavailable extends Error {
  constructor(
    readonly reason: "timeout" | "status" | "network" | "format" | "throttled",
    /** For « throttled »: how long the registry asks to wait (Retry-After), if it says. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`Business registry unavailable (${reason})`);
  }
}

// Only what is read; unknown keys are dropped. Optional or null everywhere:
// sole traders who refused publication come back with parts missing.
const text = z.string().nullish();
const ROW = z.object({
  siren: z.string().regex(/^\d{9}$/),
  nom_complet: text,
  nom_raison_sociale: text,
  nature_juridique: text,
  etat_administratif: text,
  siege: z
    .object({
      siret: text,
      adresse: text,
      code_postal: text,
      libelle_commune: text,
    })
    .nullish(),
});
const RESPONSE = z.object({ results: z.array(z.unknown()) });
type Result = z.infer<typeof ROW>;

/** Most common legal forms (INSEE « catégories juridiques »); others are left out. */
const LEGAL_FORMS: Record<string, string> = {
  "1000": "Entrepreneur individuel",
  "5498": "EURL",
  "5499": "SARL",
  "5599": "SA",
  "5710": "SAS",
  "5720": "SASU",
  "6540": "SCI",
  "9210": "Association non déclarée",
  "9220": "Association déclarée",
};

/** Masked values of a non-public sole trader (« [ND] », « [NON-DIFFUSIBLE] »). */
const shown = (v: string | null | undefined) => {
  const t = v?.trim();
  return t && !/^\[N/.test(t) && !t.includes("NON-DIFFUSIBLE") ? t : null;
};

/** One registry result → what the forms need. */
export function toBusiness(r: Result): Business {
  const postcode = shown(r.siege?.code_postal);
  const city = shown(r.siege?.libelle_commune);
  // « 59-61 RUE LA FAYETTE 75009 PARIS » → the street, without postcode and city.
  const address = shown(r.siege?.adresse);
  const suffix = [postcode, city].filter(Boolean).join(" ");
  const street =
    address && suffix && address.endsWith(suffix) ? address.slice(0, -suffix.length).trim() || null : address;
  const siret = shown(r.siege?.siret);
  return {
    legalName: shown(r.nom_raison_sociale) ?? shown(r.nom_complet) ?? r.siren,
    siren: r.siren,
    siret: siret && /^\d{14}$/.test(siret) ? siret : null,
    street,
    postcode,
    city,
    legalForm: LEGAL_FORMS[r.nature_juridique ?? ""] ?? null,
    ceased: r.etat_administratif === "C",
  };
}

/**
 * Parsed response, active companies first; a row of another shape is left
 * out rather than losing the whole search. `RegistryUnavailable("format")`
 * if the response itself is not the expected shape.
 */
export function businessesOf(json: unknown): Business[] {
  const parsed = RESPONSE.safeParse(json);
  if (!parsed.success) throw new RegistryUnavailable("format");
  const businesses = parsed.data.results.flatMap((row) => {
    const r = ROW.safeParse(row);
    return r.success ? [toBusiness(r.data)] : [];
  });
  // The registry's order is kept inside each group.
  return [...businesses.filter((b) => !b.ceased), ...businesses.filter((b) => b.ceased)];
}

/** Query as sent: a SIREN or SIRET typed with spaces loses them. */
export const normalisedQuery = (query: string) => (/^[\d\s]+$/.test(query) ? query.replace(/\s/g, "") : query.trim());

const isTimeout = (e: unknown) => e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");

/** « Retry-After » in seconds or as a date; null when absent or unreadable. */
function retryAfter(response: Response, now = Date.now()): number | null {
  const h = response.headers.get("retry-after");
  if (!h) return null;
  const seconds = Number(h);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Companies matching a name, a SIREN or a SIRET (spaces ignored). One retry
 * on a server error or a network failure, after a short pause; none on a
 * « slow down » (429), which the caller turns into a pause of every search.
 */
export async function searchRegistry(
  query: string,
  o: { fetch?: typeof fetch; timeoutMs?: number; pauseMs?: number } = {},
): Promise<Business[]> {
  const call = o.fetch ?? fetch;
  const url = `${URL_SEARCH}?${new URLSearchParams({ q: normalisedQuery(query), per_page: String(RESULTS), page: "1" })}`;
  for (let attempt = 0; ; attempt++) {
    // One time budget for the answer and its body.
    const signal = AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS);
    let response: Response;
    try {
      response = await call(url, { headers: { Accept: "application/json" }, signal, cache: "no-store" });
    } catch (e) {
      if (isTimeout(e)) throw new RegistryUnavailable("timeout");
      if (attempt === 0) {
        await pause(o.pauseMs);
        continue;
      }
      throw new RegistryUnavailable("network");
    }
    if (response.ok) {
      let json: unknown;
      try {
        // The same deadline for a body that stops arriving.
        json = await Promise.race([response.json(), rejectedWhenAborted(signal)]);
      } catch (e) {
        if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
        throw new RegistryUnavailable(isTimeout(e) || signal.aborted ? "timeout" : "format");
      }
      return businessesOf(json);
    }
    // The body is not read: released before trying again or giving up.
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429) throw new RegistryUnavailable("throttled", retryAfter(response));
    if (attempt === 0 && response.status >= 500) {
      await pause(o.pauseMs);
      continue;
    }
    throw new RegistryUnavailable("status");
  }
}

const rejectedWhenAborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

const pause = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
