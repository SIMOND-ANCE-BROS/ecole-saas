"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { avecEcole } from "@/db";
import {
  ajouterLien,
  creerPersonne,
  type Doublon,
  modifierLien,
  modifierPersonne,
  rechercherPersonnes,
  RefusLien,
  saisiePersonneValide,
  supprimerLien,
} from "@/db/personnes";
import { exigerRole } from "@/lib/session";
import { estRelation, RELATIONS } from "./relations";

export type Refus = { message: string; erreurs: Partial<Record<string, string>>; doublons?: Doublon[] };

const drapeaux = z.object({ contactUrgence: z.boolean(), paiePour: z.boolean() });

function erreursDe(issues: z.core.$ZodIssue[]): Refus["erreurs"] {
  const erreurs: Refus["erreurs"] = {};
  for (const p of issues) erreurs[String(p.path[0])] ??= p.message;
  return erreurs;
}

/**
 * Crée une personne ; avec `lien`, elle est liée d'emblée à la fiche d'où l'on
 * vient. Sans `confirme`, renvoie d'abord les doublons probables.
 */
export async function creer(saisie: unknown, confirme: boolean, lien: unknown): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const personne = saisiePersonneValide.safeParse(saisie);
  if (!personne.success) return { message: "Vérifiez les champs signalés.", erreurs: erreursDe(personne.error.issues) };
  const l = lien === null ? null : drapeaux.extend({ ficheId: z.uuid(), relation: z.string().refine(estRelation) }).safeParse(lien);
  if (l && !l.success) return { message: "Lien invalide.", erreurs: {} };

  let r;
  try {
    r = await avecEcole(ecoleId, (tx) => {
      if (!l) return creerPersonne(tx, personne.data, confirme);
      const { ficheId, relation, ...flags } = l.data;
      const { type, de } = RELATIONS[relation as keyof typeof RELATIONS];
      return creerPersonne(tx, personne.data, confirme, { ...flags, type, autreId: ficheId, de: de === "autre" ? "nouvelle" : "autre" });
    });
  } catch (e) {
    if (e instanceof RefusLien) return { message: e.message, erreurs: {} };
    throw e;
  }
  if (r.statut === "doublons") return { message: "Cette personne existe peut-être déjà.", erreurs: {}, doublons: r.doublons };
  redirect(l?.success ? `/personnes/${l.data.ficheId}?lien=ajoute` : `/personnes/${r.id}?personne=creee`);
}

export async function modifier(id: string, saisie: unknown): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const personne = saisiePersonneValide.safeParse(saisie);
  if (!personne.success) return { message: "Vérifiez les champs signalés.", erreurs: erreursDe(personne.error.issues) };
  const r = await avecEcole(ecoleId, (tx) => modifierPersonne(tx, id, personne.data));
  if (!r.ok) return { message: r.message, erreurs: {} };
  redirect(`/personnes/${id}?personne=modifiee`);
}

/** Lie la fiche à une personne existante, selon la relation choisie depuis la fiche. */
export async function lierExistante(ficheId: string, autreId: string, relation: string, flags: unknown): Promise<{ message: string }> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const f = drapeaux.safeParse(flags);
  if (!estRelation(relation) || !f.success) return { message: "Lien invalide." };
  const { type, de } = RELATIONS[relation];
  const [personneId, lieAId] = de === "autre" ? [autreId, ficheId] : [ficheId, autreId];
  const r = await avecEcole(ecoleId, (tx) => ajouterLien(tx, { personneId, lieAId, type, ...f.data }));
  if (!r.ok) return { message: r.message };
  redirect(`/personnes/${ficheId}?lien=ajoute`);
}

/** Coche ou décoche « paie pour » et « contact d'urgence » d'un lien. */
export async function changerDrapeaux(lienId: string, type: unknown, flags: unknown): Promise<{ message: string | null }> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const f = drapeaux.safeParse(flags);
  const t = z.enum(["representant_legal", "conjoint", "autre"]).safeParse(type);
  if (!f.success || !t.success) return { message: "Lien invalide." };
  const r = await avecEcole(ecoleId, (tx) => modifierLien(tx, lienId, { type: t.data, ...f.data }));
  return { message: r.ok ? null : r.message };
}

export async function retirerLien(lienId: string): Promise<{ message: string | null }> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const r = await avecEcole(ecoleId, (tx) => supprimerLien(tx, lienId));
  return { message: r.ok ? null : r.message };
}

/** Recherche d'une personne à lier, pendant la frappe. */
export async function chercherPersonnes(saisie: string) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  if (typeof saisie !== "string") return [];
  return avecEcole(ecoleId, (tx) => rechercherPersonnes(tx, saisie.slice(0, 100)));
}
