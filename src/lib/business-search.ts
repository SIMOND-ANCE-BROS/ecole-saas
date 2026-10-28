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

type Options = {
  search?: (query: string) => Promise<Business[]>;
  now?: () => number;
};

/**
 * Business registry search shared by every school of this server (#207).
 * The State API allows about seven calls per second per server: a short
 * cache, a budget for the whole server, a smaller one per member, and a
 * pause of every search after a « slow down » keep below it. Over budget,
 * the member reads « type by hand », the registry is not called.
 */
export function createBusinessSearch({ search = (q) => searchRegistry(q), now = Date.now }: Options = {}) {
  const everyone = new TokenBucket(5, 5, now());
  const members = new KeyedBuckets(3, 1);
  const breaker = new Breaker();
  const cache = new Map<string, { at: number; results: Business[] }>();

  return async function find(who: { schoolId: string; userId: string }, query: string): Promise<RegistrySearch> {
    const t = now();
    // Per school: nothing seen by one school is served to another.
    const key = `${who.schoolId}:${normalisedQuery(query).toLowerCase()}`;
    const kept = cache.get(key);
    if (kept && t - kept.at < CACHE_MS) return { ok: true, results: kept.results };
    if (breaker.isOpen(t) || !members.take(who.userId, t) || !everyone.take(t))
      return { ok: false, message: UNAVAILABLE };
    try {
      const results = await search(query);
      cache.delete(key);
      cache.set(key, { at: now(), results });
      // A Map keeps insertion order: the oldest goes first.
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value ?? "");
      return { ok: true, results };
    } catch (e) {
      if (e instanceof RegistryUnavailable && e.reason === "throttled") breaker.open(now(), e.retryAfterMs ?? PAUSE_MS);
      // The reason only: the query may be a person's name.
      console.warn(`business registry: ${e instanceof RegistryUnavailable ? e.reason : "unexpected error"}`);
      return { ok: false, message: UNAVAILABLE };
    }
  };
}

/** The one instance of this server. */
export const findBusinesses = createBusinessSearch();
