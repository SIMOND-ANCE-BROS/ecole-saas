"use server";

import { z } from "zod";
import { withSchool } from "@/db";
import { savePreference } from "@/db/preferences";
import { LISTS } from "@/domain/filters/columns";
import { writeLayout, readLayout } from "@/domain/filters/layout";
import { schoolContext } from "@/lib/session";

const entry = z.object({
  list: z.enum(Object.keys(LISTS) as [keyof typeof LISTS, ...(keyof typeof LISTS)[]]),
  columns: z.array(z.string().max(40)).max(40),
});

export type SaveColumnsResult = { ok: true } | { ok: false; message: string };

const NOT_SAVED = "Colonnes non enregistrées : réessayez.";

/** Saves the order and visibility of a list's columns for the signed-in member (#89). */
export async function saveColumns(list: unknown, columns: unknown): Promise<SaveColumnsResult> {
  const { schoolId: schoolId, userId } = await schoolContext();
  const v = entry.safeParse({ list: list, columns: columns });
  if (!v.success) return { ok: false, message: NOT_SAVED };
  // Normalised: known columns only, at least one visible.
  const own = writeLayout(readLayout(LISTS[v.data.list], v.data.columns));
  try {
    const saved = await withSchool(schoolId, (tx) => savePreference(tx, userId, v.data.list, own));
    return saved ? { ok: true } : { ok: false, message: NOT_SAVED };
  } catch (e) {
    // A layout preference is not worth an error page (#212); technical ids only in the log.
    console.error("saveColumns failed", { list: v.data.list, error: e instanceof Error ? e.name : "unknown" });
    return { ok: false, message: NOT_SAVED };
  }
}
