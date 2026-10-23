import type { z } from "zod";

/** Premier message d'erreur de chaque champ (préfixé pour les sous-formulaires), pour l'afficher sous le champ. */
export function errorsOf(issues: z.core.$ZodIssue[], prefix = ""): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  for (const p of issues) errors[`${prefix}${p.path.map(String).join(".")}`] ??= p.message;
  return errors;
}
