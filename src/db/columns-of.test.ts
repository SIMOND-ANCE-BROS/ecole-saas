import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { columnsOf, rowsOf } from "./columns-of";
import { calendarConnection, member } from "./schema";

// The compile-time checks are the point: `npm run typecheck` fails if an
// unknown key stops being rejected (each @ts-expect-error becomes unused).
describe("columnsOf", () => {
  it("keeps a payload whose keys are all columns", () => {
    const row = { role: "director" as const, active: false };
    expect(columnsOf(member, row)).toBe(row);
  });

  it("rejects an unknown key, even through a spread or a conditional spread", () => {
    const stale = { role: "director" as const, actif: false };
    // @ts-expect-error `actif` is not a column of member.
    columnsOf(member, { ...stale });
    const renewed: string | undefined = "token";
    // @ts-expect-error `jetonChiffre` is not a column of calendar_connection.
    columnsOf(calendarConnection, { error: null, ...(renewed ? { jetonChiffre: renewed } : {}) });
    const either = stale as typeof stale | { role: "director" };
    // @ts-expect-error `actif`, declared by one member of the union only.
    columnsOf(member, either);
  });

  it("accepts SQL values, checked later by Drizzle", () => {
    expect(columnsOf(calendarConnection, { lastSyncedAt: sql`now()` })).toHaveProperty("lastSyncedAt");
  });
});

describe("rowsOf", () => {
  it("keeps the rows and rejects an unknown key in mapped rows", () => {
    const ids = ["a", "b"];
    const rows = ids.map((userId) => ({ userId }));
    expect(rowsOf(member, rows)).toEqual([{ userId: "a" }, { userId: "b" }]);
    const stale = ids.map((userId) => ({ userId, nom: "N" }));
    // @ts-expect-error `nom` is not a column of member.
    rowsOf(member, stale);
  });
});
