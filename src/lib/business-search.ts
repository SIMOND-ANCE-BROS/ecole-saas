import {
  type Business,
  normalisedQuery,
  RegistryUnavailable,
  searchRegistry,
} from "../connectors/business-registry/registry";
import { Breaker, KeyedBuckets, TokenBucket } from "./rate-limit";

export type RegistrySearch = { ok: true; results: Business[] } | { ok: false; message: string };

export const UNAVAILABLE = "Recherche indisponible, saisissez à la main.";

const CACHE_MS = 10 * 60 * 1000;
const CACHE_SIZE = 200;
/** After a 429 without Retry-After. */
const PAUSE_MS = 30 * 1000;
/** A Retry-After longer than this is not believed: searches come back after 5 minutes. */
const MAX_PAUSE_MS = 5 * 60 * 1000;

type Options = {
  search?: (query: string, signal?: AbortSignal) => Promise<Business[]>;
  now?: () => number;
};

/**
 * Business registry search shared by every school of this server (#207).
 * The State API allows about seven calls per second per server: a short
 * cache, a budget for the whole server, a smaller one per member, and a
 * pause of every search after a « slow down » keep below it. Over budget,
 * the member reads « type by hand », the registry is not called.
 */
export function createBusinessSearch({
  search = (q, signal) => searchRegistry(q, { signal }),
  now = Date.now,
}: Options = {}) {
  const everyone = new TokenBucket(5, 5, now());
  const members = new KeyedBuckets(3, 1);
  const breaker = new Breaker();
  const cache = new Map<string, { at: number; results: Business[] }>();

  /** `signal`: the browser's request, cancelled when a newer search replaces it. */
  return async function find(
    who: { schoolId: string; userId: string },
    query: string,
    signal?: AbortSignal,
  ): Promise<RegistrySearch> {
    const t = now();
    // Per school: nothing seen by one school is served to another.
    const key = `${who.schoolId}:${normalisedQuery(query).toLowerCase()}`;
    const kept = cache.get(key);
    if (kept && t - kept.at < CACHE_MS) return { ok: true, results: kept.results };
    // The server's budget is looked at first: a refusal there costs the member nothing.
    if (breaker.isOpen(t) || !everyone.canTake(t) || !members.take(who.userId, t) || !everyone.take(t))
      return { ok: false, message: UNAVAILABLE };
    try {
      const results = await search(query, signal);
      cache.delete(key);
      cache.set(key, { at: now(), results });
      // A Map keeps insertion order: the oldest goes first.
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value ?? "");
      return { ok: true, results };
    } catch (e) {
      // Nobody is waiting for this answer any more: not a registry failure.
      if (e instanceof RegistryUnavailable && e.reason === "cancelled") return { ok: false, message: UNAVAILABLE };
      if (e instanceof RegistryUnavailable && e.reason === "throttled")
        breaker.open(now(), Math.min(e.retryAfterMs ?? PAUSE_MS, MAX_PAUSE_MS));
      // The reason only: the query may be a person's name.
      console.warn(`business registry: ${e instanceof RegistryUnavailable ? e.reason : "unexpected error"}`);
      return { ok: false, message: UNAVAILABLE };
    }
  };
}

/** The one instance of this server. */
export const findBusinesses = createBusinessSearch();
