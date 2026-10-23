import type { NextRequest } from "next/server";
import { z } from "zod";
import { withSchool } from "@/db";
import { readCalendar } from "@/db/calendar-feed";
import { icsCalendar } from "@/domain/schedule/ical";

/** History kept in the instructor's calendar. */
const PAST_DAYS = 60;

/**
 * An instructor's private iCal subscription: `/agenda/<école>/<jeton>.ics`.
 * No session (calendars don't authenticate): the school restricts reading
 * through RLS, the token is the secret. Same response for an unknown school
 * or token.
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
