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
  constructor(readonly reason: "timeout" | "status" | "network" | "format") {
    super(`Business registry unavailable (${reason})`);
  }
}

// Only what is read; unknown keys are dropped. Optional or null everywhere:
// sole traders who refused publication come back with parts missing.
const text = z.string().nullish();
const RESPONSE = z.object({
  results: z.array(
    z.object({
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
    }),
  ),
});
type Result = z.infer<typeof RESPONSE>["results"][number];

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

/** Parsed response; `RegistryUnavailable("format")` if it is not the expected shape. */
export function businessesOf(json: unknown): Business[] {
  const parsed = RESPONSE.safeParse(json);
  if (!parsed.success) throw new RegistryUnavailable("format");
  return parsed.data.results.map(toBusiness);
}

const retried = (status: number) => status === 429 || status >= 500;

/**
 * Companies matching a name, a SIREN or a SIRET (spaces ignored). One retry
 * on a refusal for load (429) or a server error, after a short pause.
 */
export async function searchRegistry(
  query: string,
  o: { fetch?: typeof fetch; timeoutMs?: number; pauseMs?: number } = {},
): Promise<Business[]> {
  const call = o.fetch ?? fetch;
  const q = /^[\d\s]+$/.test(query) ? query.replace(/\s/g, "") : query.trim();
  const url = `${URL_SEARCH}?${new URLSearchParams({ q, per_page: String(RESULTS), page: "1" })}`;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await call(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      const timeout = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      if (attempt === 0 && !timeout) {
        await pause(o.pauseMs);
        continue;
      }
      throw new RegistryUnavailable(timeout ? "timeout" : "network");
    }
    if (response.ok) {
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new RegistryUnavailable("format");
      }
      return businessesOf(json);
    }
    if (attempt === 0 && retried(response.status)) {
      await pause(o.pauseMs);
      continue;
    }
    throw new RegistryUnavailable("status");
  }
}

const pause = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
