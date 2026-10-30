import { sweep } from "../../../../jobs/invoicing/send";
import { bearerMatches } from "../../../../lib/bearer";

/**
 * Sweep of the invoice outbox (#304, ADR 0007), called by the host's scheduler every minute or
 * so: `POST /api/taches/factures` with `Authorization: Bearer <JOBS_SECRET>`. No session: the
 * secret, compared in constant time and never logged, is the only way in; a server without
 * `JOBS_SECRET` refuses every call. Works school by school under RLS; answers counts only.
 */
export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.JOBS_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const report = await sweep();
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
