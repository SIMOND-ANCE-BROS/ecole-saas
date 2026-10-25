import type { z } from "zod";

type Join<K extends string, P> = P extends string ? `${K}.${P}` : never;

/**
 * Dotted paths of a form input (`billing.payer.newPerson.name`), the keys of
 * its field errors. A key renamed on one side (schema or form) then fails to
 * compile instead of hiding the message (#138). Unions contribute the keys of
 * every member; arrays stop the path (errors are shown on the list field).
 */
export type FieldPath<T, Depth extends unknown[] = []> = Depth["length"] extends 4
  ? never
  : T extends readonly unknown[]
    ? never
    : T extends object
      ? { [K in keyof T & string]-?: K | Join<K, FieldPath<NonNullable<T[K]>, [...Depth, unknown]>> }[keyof T & string]
      : never;

/** Message of each field, keyed by its path in the form input. */
export type FieldErrors<T> = Partial<Record<FieldPath<T>, string>>;

/** First error message of each field, keyed by its full path, to display under the field. */
export function errorsOf<T>(issues: z.core.$ZodIssue[]): FieldErrors<T> {
  const errors: Partial<Record<string, string>> = {};
  for (const p of issues) errors[p.path.map(String).join(".")] ??= p.message;
  // Zod issue paths are paths of the parsed input, i.e. of T.
  return errors as FieldErrors<T>;
}

/** First error message of each top-level field (flat forms). */
export function topErrorsOf<T>(issues: z.core.$ZodIssue[]): Partial<Record<keyof T & string, string>> {
  const errors: Partial<Record<string, string>> = {};
  for (const p of issues) errors[String(p.path[0])] ??= p.message;
  // The first segment of a Zod issue path is a key of the parsed object.
  return errors as Partial<Record<keyof T & string, string>>;
}

/**
 * Custom issue path (`refine`, `addIssue`) checked against the keys of the
 * object schema it refines: a renamed field fails to compile.
 */
export function issuePath<S extends z.ZodObject>(
  _schema: S,
  ...path: [keyof z.input<S> & string, ...(string | number)[]]
): (string | number)[] {
  return path;
}
