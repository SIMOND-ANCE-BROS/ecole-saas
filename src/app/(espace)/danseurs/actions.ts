"use server";

import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import { creerDanseur, modifierDanseur, saisieDanseurValide } from "@/db/danseurs";
import { exigerRole } from "@/lib/session";

export type EtatFormulaire = {
  /** Incrémenté à chaque refus : le formulaire est remonté avec la saisie renvoyée. */
  essai: number;
  erreurs: Partial<Record<string, string>>;
  valeurs: Record<string, string> | null;
};

const CHAMPS = ["prenom", "nom", "dateNaissance", "contactUrgence", "telephoneUrgence", "notes"] as const;

/** Ajoute un danseur à une famille (`payeurId`) ou modifie un danseur (`id`). */
export async function enregistrerDanseur(
  cible: { payeurId: string } | { id: string },
  etat: EtatFormulaire,
  f: FormData,
): Promise<EtatFormulaire> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const valeurs = Object.fromEntries(CHAMPS.map((n) => [n, String(f.get(n) ?? "")]));
  const refus = (erreurs: EtatFormulaire["erreurs"]) => ({ essai: etat.essai + 1, erreurs, valeurs });
  const donnees = saisieDanseurValide.safeParse(valeurs);
  if (!donnees.success) {
    const erreurs: EtatFormulaire["erreurs"] = {};
    for (const p of donnees.error.issues) erreurs[String(p.path[0])] ??= p.message;
    return refus(erreurs);
  }
  const resultat = await avecEcole(ecoleId, (tx) =>
    "id" in cible ? modifierDanseur(tx, cible.id, donnees.data) : creerDanseur(tx, cible.payeurId, donnees.data),
  );
  if (!resultat.ok) return refus({ formulaire: resultat.message });
  redirect(`/danseurs/${resultat.id}?enregistre=1`);
}
