/**
 * Rewrites the Drizzle snapshot of a hand-written migration from `src/db/schema.ts` (#114).
 *
 * `drizzle-kit generate` asks interactively whether a column was renamed or
 * replaced, which neither agents nor CI can answer. Renames are therefore
 * written by hand in a custom migration (`drizzle-kit generate --custom`), and
 * this script makes its snapshot match the schema, keeping `id` and `prevId`.
 * Afterwards `npx drizzle-kit generate` must report no schema change.
 *
 * Usage:
 *   npx tsx scripts/sync-drizzle-snapshot.ts --check migrations/meta/0026_snapshot.json
 *   npx tsx scripts/sync-drizzle-snapshot.ts --write migrations/meta/0027_snapshot.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { generateDrizzleJson } from "drizzle-kit/api";
import * as schema from "../src/db/schema";

type Snapshot = { id: string; prevId: string; tables: unknown; enums: unknown } & Record<string, unknown>;

const [mode, path] = process.argv.slice(2);
if ((mode !== "--check" && mode !== "--write") || !path) {
  console.error("Usage: sync-drizzle-snapshot.ts --check|--write <snapshot.json>");
  process.exit(2);
}

const current = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
const generated = generateDrizzleJson(schema, current.prevId) as Snapshot;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const matches = same(current.tables, generated.tables) && same(current.enums, generated.enums);

if (mode === "--check") {
  console.log(matches ? "Snapshot matches the schema." : "Snapshot differs from the schema.");
  process.exit(matches ? 0 : 1);
}

writeFileSync(path, `${JSON.stringify({ ...generated, id: current.id, prevId: current.prevId }, null, 2)}\n`);
console.log(`Snapshot ${path} rewritten from the schema.`);
