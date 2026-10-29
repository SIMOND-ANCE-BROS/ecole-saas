import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Journal = { entries: { tag: string }[] };

/**
 * A copy of the migrations folder whose journal stops just before `tag`: a throwaway
 * database migrated with it is in the state the migration `tag` will find, to be filled
 * as data was then and migrated to the end (replay tests of a backfill). The caller
 * removes the folder.
 */
export function migrationsBefore(tag: string): string {
  const folder = mkdtempSync(join(tmpdir(), "zz-migrations-"));
  mkdirSync(join(folder, "meta"));
  for (const f of readdirSync("migrations"))
    if (f.endsWith(".sql")) copyFileSync(join("migrations", f), join(folder, f));
  const journal = JSON.parse(readFileSync("migrations/meta/_journal.json", "utf8")) as Journal;
  const stop = journal.entries.findIndex((e) => e.tag === tag);
  if (stop < 0) throw new Error(`${tag} absent du journal`);
  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, stop) }),
  );
  return folder;
}
