"use server";

import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import { creerIntervenant, modifierIntervenant, saisieIntervenantValide } from "@/db/intervenants";
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
