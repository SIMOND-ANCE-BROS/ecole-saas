import type { Tx } from "@/db";
import { currentSeason, seasonOfCourse } from "@/db/schedule";
import { todayInParis } from "@/domain/people/age";
import { seasonParam, withSeason } from "./season-link";

/**
 * Breadcrumb back to the planning of a course's season (#189): « Planning
 * 2027-2028 », with `?saison=` only when it is not the current season.
 */
export async function coursePlanning(tx: Tx, courseId: string): Promise<{ label: string; href: string }> {
  const season = await seasonOfCourse(tx, courseId);
  if (!season) return { label: "Planning", href: "/planning" };
  const current = await currentSeason(tx, todayInParis());
  return { label: `Planning ${season.label}`, href: withSeason("/planning", seasonParam(season.id, current?.id)) };
}
