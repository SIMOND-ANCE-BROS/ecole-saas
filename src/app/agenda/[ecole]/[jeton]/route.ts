import type { NextRequest } from "next/server";
import { z } from "zod";
import { avecEcole } from "@/db";
import { lireAgenda } from "@/db/agenda";
import { agendaIcs } from "@/domaine/planning/ical";

/** Historique gardé dans l'agenda de l'intervenant. */
const JOURS_PASSES = 60;

/**
 * Abonnement iCal privé d'un intervenant : `/agenda/<école>/<jeton>.ics`.
 * Sans session (les agendas ne s'authentifient pas) : l'école limite la lecture
 * par la RLS, le jeton en est le secret. Réponse identique pour une école ou un
 * jeton inconnus.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/agenda/[ecole]/[jeton]">) {
  const { ecole, jeton } = await ctx.params;
  const introuvable = new Response("Abonnement introuvable ou révoqué.", { status: 404 });
  if (!z.uuid().safeParse(ecole).success || !jeton.endsWith(".ics")) return introuvable;

  const depuis = new Date(Date.now() - JOURS_PASSES * 86_400_000).toISOString().slice(0, 10);
  const agenda = await avecEcole(ecole, (tx) => lireAgenda(tx, jeton.slice(0, -".ics".length), depuis));
  if (!agenda) return introuvable;

  return new Response(agendaIcs({ ...agenda, genereLe: new Date() }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="seances.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
