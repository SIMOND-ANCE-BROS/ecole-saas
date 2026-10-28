import { z } from "zod";
import { findBusinesses, type RegistrySearch } from "@/lib/business-search";
import { requireRole } from "@/lib/session";

const QUERY = z.string().trim().min(3, "Tapez au moins 3 caractères.").max(100, "Recherche trop longue.");

/**
 * Business registry search while typing (`?q=`, #207). A GET route rather
 * than a server action: Next runs a page's server actions one after the
 * other, so searches would queue up and « Enregistrer » would wait behind
 * them; here the browser cancels the searches it no longer needs.
 */
export async function GET(request: Request) {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  const q = QUERY.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  const body: RegistrySearch = q.success
    ? await findBusinesses({ schoolId, userId }, q.data)
    : { ok: false, message: q.error.issues[0]?.message ?? "Recherche invalide." };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
