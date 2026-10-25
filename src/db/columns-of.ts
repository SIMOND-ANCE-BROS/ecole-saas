import type { Table } from "drizzle-orm";

// Keys of every member of a union (`keyof (A | B)` keeps only the shared ones).
type KeysOfUnion<R> = R extends unknown ? keyof R : never;

/**
 * Payload of `insert().values()`, `update().set()` or
 * `onConflictDoUpdate({ set })` whose keys must all be columns of `table`.
 * Drizzle drops an unknown key without error when the object is not a fresh
 * literal (a spread, a row built by a function): a renamed form key then
 * stops saving silently (#134). Only keys are checked here: Drizzle still
 * checks values and required columns.
 * A lint rule requires it whenever the payload is not a literal without spread.
 */
export function columnsOf<T extends Table, R extends object>(
  _table: T,
  row: R & { [K in Exclude<KeysOfUnion<R>, keyof T["$inferInsert"]>]: never },
): R {
  return row;
}

/** `columnsOf()` for the rows of a multi-row insert. */
export function rowsOf<T extends Table, R extends object>(
  _table: T,
  rows: readonly (R & { [K in Exclude<KeysOfUnion<R>, keyof T["$inferInsert"]>]: never })[],
): R[] {
  return [...rows];
}
