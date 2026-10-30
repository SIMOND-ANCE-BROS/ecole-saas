import type postgres from "postgres";
import { defaultQuarters } from "../domain/enrollment/quarters";

/**
 * Gives a season inserted by hand its default quarters (#291), as `createSeason` does: a
 * quarterly enrollment is refused in a season without quarters. Returns their ids in date order.
 */
export async function withDefaultQuarters(admin: postgres.Sql, seasonId: string): Promise<string[]> {
  const [s] = await admin<{ schoolId: string; start: string; end: string }[]>`
    SELECT school_id AS "schoolId", to_char(start_date, 'YYYY-MM-DD') AS start, to_char(end_date, 'YYYY-MM-DD') AS end
    FROM season WHERE id = ${seasonId}`;
  const ids: string[] = [];
  for (const q of defaultQuarters({ startDate: s.start, endDate: s.end })) {
    const [{ id }] = await admin<{ id: string }[]>`
      INSERT INTO season_quarter (school_id, season_id, label, start_date, end_date)
      VALUES (${s.schoolId}, ${seasonId}, ${q.label}, ${q.startDate}, ${q.endDate}) RETURNING id`;
    ids.push(id);
  }
  return ids;
}
