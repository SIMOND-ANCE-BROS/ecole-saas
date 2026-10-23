import type { z } from "zod";

/** First error message of each field (prefixed for sub-forms), to display under the field. */
export function errorsOf(issues: z.core.$ZodIssue[], prefix = ""): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  for (const p of issues) errors[`${prefix}${p.path.map(String).join(".")}`] ??= p.message;
  return errors;
}
