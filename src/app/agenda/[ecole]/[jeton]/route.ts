import type { NextRequest } from "next/server";
import { z } from "zod";
import { withSchool } from "@/db";
import { readCalendar } from "@/db/agenda";
import { icsCalendar } from "@/domaine/planning/ical";

/** Historique gardé dans l'agenda de l'intervenant. */
const PAST_DAYS = 60;

/**
 * Abonnement iCal privé d'un intervenant : `/agenda/<école>/<jeton>.ics`.
 * Sans session (les agendas ne s'authentifient pas) : l'école limite la lecture
 * par la RLS, le jeton en est le secret. Réponse identique pour une école ou un
 * jeton inconnus.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/agenda/[ecole]/[jeton]">) {
  const { ecole, jeton } = await ctx.params;
  const notFound = new Response("Abonnement introuvable ou révoqué.", { status: 404 });
  if (!z.uuid().safeParse(ecole).success || !jeton.endsWith(".ics")) return notFound;

  const since = new Date(Date.now() - PAST_DAYS * 86_400_000).toISOString().slice(0, 10);
  const calendar = await withSchool(ecole, (tx) => readCalendar(tx, jeton.slice(0, -".ics".length), since));
  if (!calendar) return notFound;

  return new Response(icsCalendar({ ...calendar, generatedAt: new Date() }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="seances.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
