import type { z } from "zod";

/** Premier message d'erreur de chaque champ (préfixé pour les sous-formulaires), pour l'afficher sous le champ. */
export function erreursDe(issues: z.core.$ZodIssue[], prefixe = ""): Partial<Record<string, string>> {
  const erreurs: Partial<Record<string, string>> = {};
  for (const p of issues) erreurs[`${prefixe}${p.path.map(String).join(".")}`] ??= p.message;
  return erreurs;
}
