"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { avecEcole } from "@/db";
import { creerFamille, type Doublon, modifierFamille, saisieFamilleValide } from "@/db/familles";
import { exigerRole } from "@/lib/session";

export type Refus = { message: string; erreurs: Partial<Record<string, string>>; doublons?: Doublon[] };

const premierValide = z
  .object({
    prenom: z.string().trim().max(100),
    dateNaissance: z.union([z.literal(""), z.iso.date("Date invalide")]),
  })
  .transform((d) => (d.prenom ? { prenom: d.prenom, dateNaissance: d.dateNaissance || null } : null));

function erreursDe(issues: z.core.$ZodIssue[], prefixe = ""): Refus["erreurs"] {
  const erreurs: Refus["erreurs"] = {};
  for (const p of issues) erreurs[`${prefixe}${String(p.path[0])}`] ??= p.message;
  return erreurs;
}

/** Crée une famille ; sans `confirme`, renvoie d'abord les doublons probables. */
export async function creer(saisie: unknown, premier: unknown, confirme: boolean): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const famille = saisieFamilleValide.safeParse(saisie);
  const danseur = premierValide.safeParse(premier);
  if (!famille.success || !danseur.success) {
    return {
      message: "Vérifiez les champs signalés.",
      erreurs: { ...(famille.error ? erreursDe(famille.error.issues) : {}), ...(danseur.error ? erreursDe(danseur.error.issues, "danseur.") : {}) },
    };
  }
  const r = await avecEcole(ecoleId, (tx) => creerFamille(tx, famille.data, danseur.data, confirme));
  if (r.statut === "doublons") {
    return { message: "Cette famille existe peut-être déjà.", erreurs: {}, doublons: r.doublons };
  }
  redirect(`/familles/${r.id}?famille=creee`);
}

export async function modifier(id: string, saisie: unknown): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const famille = saisieFamilleValide.safeParse(saisie);
  if (!famille.success) return { message: "Vérifiez les champs signalés.", erreurs: erreursDe(famille.error.issues) };
  const r = await avecEcole(ecoleId, (tx) => modifierFamille(tx, id, famille.data));
  if (!r.ok) return { message: r.message, erreurs: {} };
  redirect(`/familles/${id}?famille=modifiee`);
}
