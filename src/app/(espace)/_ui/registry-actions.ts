"use server";

import { z } from "zod";
import { type Business, RegistryUnavailable, searchRegistry } from "@/connectors/business-registry/registry";
import { requireRole } from "@/lib/session";

export type RegistrySearch = { ok: true; results: Business[] } | { ok: false; message: string };

const QUERY = z.string().trim().min(3, "Tapez au moins 3 caractères.").max(100, "Recherche trop longue.");

// The registry allows a few calls per second for the whole server, all
// schools together: the same search typed again within ten minutes is not
// sent again. Public data only (no school data), bounded size.
const CACHE_MS = 10 * 60 * 1000;
const CACHE_SIZE = 200;
const cache = new Map<string, { at: number; results: Business[] }>();

/** Companies matching a name, a SIREN or a SIRET (#207), for members who enter people. */
export async function searchBusinesses(query: unknown): Promise<RegistrySearch> {
  await requireRole("director", "front_desk");
  const q = QUERY.safeParse(query);
  if (!q.success) return { ok: false, message: q.error.issues[0]?.message ?? "Recherche invalide." };
  const key = q.data.toLowerCase();
  const kept = cache.get(key);
  if (kept && Date.now() - kept.at < CACHE_MS) return { ok: true, results: kept.results };
  try {
    const results = await searchRegistry(q.data);
    cache.delete(key);
    cache.set(key, { at: Date.now(), results });
    // Oldest first in a Map: drop it beyond the bound.
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value ?? "");
    return { ok: true, results };
  } catch (e) {
    // The reason only: the query may be a person's name.
    console.warn(`business registry: ${e instanceof RegistryUnavailable ? e.reason : "unexpected error"}`);
    return { ok: false, message: "Recherche indisponible, saisissez à la main." };
  }
}
