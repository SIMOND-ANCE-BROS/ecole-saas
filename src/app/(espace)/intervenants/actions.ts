"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { avecEcole } from "@/db";
import { creerJetonAgenda, revoquerJetonAgenda } from "@/db/agenda";
import { ajouterIndisponibilite, supprimerIndisponibilite } from "@/db/disponibilites";
import { creerIntervenant, modifierIntervenant, saisieIntervenantValide } from "@/db/intervenants";
import { instantParis } from "@/domaine/planning/disponibilite";
import { lireEuros } from "@/lib/montant";
import { exigerRole } from "@/lib/session";

export type EtatFormulaire = {
  /** Incrémenté à chaque refus : le formulaire est remonté avec la saisie renvoyée. */
  essai: number;
  erreurs: Partial<Record<string, string>>;
  valeurs: Record<string, string> | null;
};

const texte = (f: FormData, nom: string) => String(f.get(nom) ?? "");

/** Crée (id null) ou modifie un intervenant ; réservé à la direction. */
export async function enregistrerIntervenant(id: string | null, etat: EtatFormulaire, f: FormData): Promise<EtatFormulaire> {
  const { ecoleId } = await exigerRole("direction");
  const valeurs = Object.fromEntries(
    ["prenom", "nom", "email", "statut", "siren", "regimeTva", "modeRemuneration", "tarif"].map((n) => [n, texte(f, n)]),
  );
  const tarifCentimes = lireEuros(valeurs.tarif);
  const donnees = saisieIntervenantValide.safeParse({
    ...valeurs,
    tarifCentimes: tarifCentimes ?? -1,
    estDirigeant: f.get("estDirigeant") === "on",
    actif: id === null || f.get("actif") === "on",
  });
  const refus = (erreurs: EtatFormulaire["erreurs"]) => ({
    essai: etat.essai + 1,
    erreurs,
    valeurs: { ...valeurs, estDirigeant: texte(f, "estDirigeant"), actif: texte(f, "actif") },
  });
  if (!donnees.success) {
    const erreurs: EtatFormulaire["erreurs"] = {};
    for (const p of donnees.error.issues) erreurs[String(p.path[0])] ??= p.message;
    if (erreurs.tarifCentimes) erreurs.tarif = "Montant en euros, par exemple 35 ou 35,50";
    return refus(erreurs);
  }

  const resultat = await avecEcole(ecoleId, async (tx) =>
    id === null ? creerIntervenant(tx, donnees.data) : (await modifierIntervenant(tx, id, donnees.data)) ? id : null,
  );
  if (resultat === null) return refus({ formulaire: "Cet intervenant n’existe plus." });
  redirect(`/intervenants?enregistre=${resultat}`);
}

/** Adresse publique de l'application, prise sur la requête (derrière un proxy : en-têtes X-Forwarded-*). */
async function origine(): Promise<string> {
  const h = await headers();
  const hote = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocole = h.get("x-forwarded-proto") ?? (hote.startsWith("localhost") ? "http" : "https");
  return `${protocole}://${hote}`;
}

/** Crée ou remplace le lien d'abonnement à l'agenda ; l'adresse n'est montrée qu'une fois. */
export async function creerLienAgenda(intervenantId: string): Promise<{ url: string } | { message: string }> {
  const { ecoleId } = await exigerRole("direction");
  const jeton = await avecEcole(ecoleId, (tx) => creerJetonAgenda(tx, intervenantId));
  if (!jeton) return { message: "Cet intervenant n’existe plus." };
  revalidatePath(`/intervenants/${intervenantId}`);
  return { url: `${await origine()}/agenda/${ecoleId}/${jeton}.ics` };
}

export async function revoquerLienAgenda(intervenantId: string): Promise<{ message: string | null }> {
  const { ecoleId } = await exigerRole("direction");
  const ok = await avecEcole(ecoleId, (tx) => revoquerJetonAgenda(tx, intervenantId));
  revalidatePath(`/intervenants/${intervenantId}`);
  return { message: ok ? null : "Cet intervenant n’existe plus." };
}

const saisieIndisponibilite = z
  .object({
    du: z.iso.date("Date de début invalide"),
    au: z.iso.date("Date de fin invalide"),
    de: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide")]),
    a: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide")]),
    libelle: z.string().max(100),
  })
  .refine((s) => (s.de === "") === (s.a === ""), "Indiquez les deux heures, ou aucune pour des journées entières.");

/** Journées entières (sans heures) ou plage horaire, en heure de Paris. */
export async function ajouterIndispo(intervenantId: string, saisie: unknown): Promise<{ message: string | null }> {
  const { ecoleId } = await exigerRole("direction");
  const s = saisieIndisponibilite.safeParse(saisie);
  if (!s.success) return { message: s.error.issues[0].message };
  const { du, au, de, a, libelle } = s.data;
  const lendemain = new Date(Date.parse(au) + 86_400_000).toISOString().slice(0, 10);
  const debut = new Date(instantParis(du, de || "00:00"));
  const fin = new Date(de ? instantParis(au, a) : instantParis(lendemain, "00:00"));
  const r = await avecEcole(ecoleId, (tx) => ajouterIndisponibilite(tx, intervenantId, { debut, fin, libelle }));
  revalidatePath(`/intervenants/${intervenantId}`);
  return { message: r.ok ? null : r.message };
}

export async function retirerIndispo(intervenantId: string, id: string): Promise<{ message: string | null }> {
  const { ecoleId } = await exigerRole("direction");
  const r = await avecEcole(ecoleId, (tx) => supprimerIndisponibilite(tx, id));
  revalidatePath(`/intervenants/${intervenantId}`);
  return { message: r.ok ? null : r.message };
}
