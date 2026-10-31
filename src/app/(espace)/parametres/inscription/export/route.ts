import { withSchool } from "@/db";
import { referralCounts } from "@/db/internal-rules";
import { currentSeason } from "@/db/schedule";
import { todayInParis } from "@/domain/people/age";
import { csvDocument, csvText } from "@/lib/csv";
import { requireRole } from "@/lib/session";

/**
 * CSV export of the answers to « Comment nous avez-vous connus ? » (#296), for
 * the statistics: per answer, the students new this season and all students.
 * Counts only, no name. Management, as the page.
 */
export async function GET() {
  const { schoolId } = await requireRole("director");
  const today = todayInParis();
  const { season, counts } = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, today);
    return { season, counts: await referralCounts(tx, season?.id ?? null) };
  });
  const header = ["Réponse", ...(season ? [`Nouveaux élèves ${season.label}`] : []), "Tous les élèves"];
  const csv = csvDocument(
    header,
    counts.map((c) => [csvText(c.label), ...(season ? [String(c.newThisSeason)] : []), String(c.students)]),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="comment-nous-avez-vous-connus-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
