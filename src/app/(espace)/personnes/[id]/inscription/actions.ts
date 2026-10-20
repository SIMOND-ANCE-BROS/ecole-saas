"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { avecEcole } from "@/db";
import { type Apercu, apercuInscription, enregistrerInscription } from "@/db/inscriptions";
import { saisonCourante } from "@/db/planning";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";

const saisieValide = z.object({
  payeurId: z.uuid(),
  danseurIds: z.array(z.uuid()).max(2),
  public: z.enum(["enfant", "adulte", "couple", "etudiant"]),
  periodicite: z.enum(["trimestre", "annee", "unite"]),
  coursIds: z.array(z.uuid()).max(10),
});

export type SaisieFormulaire = z.infer<typeof saisieValide>;

const MESSAGE_SANS_SAISON = "Aucune saison n’est paramétrée.";
const SANS_SAISON: Apercu = { statut: "invalide", message: MESSAGE_SANS_SAISON };

/** Aperçu du prix, recalculé côté serveur à chaque changement de la saisie. */
export async function apercu(saisie: SaisieFormulaire): Promise<Apercu> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const donnees = saisieValide.safeParse(saisie);
  if (!donnees.success) return { statut: "invalide", message: "Saisie invalide." };
  const { payeurId, ...reste } = donnees.data;
  return avecEcole(ecoleId, async (tx) => {
    const saison = await saisonCourante(tx, aujourdhuiAParis());
    return saison ? apercuInscription(tx, payeurId, saison.id, reste) : SANS_SAISON;
  });
}

/** Enregistre l'inscription ; en cas de refus, renvoie le message à afficher. */
export async function inscrire(saisie: SaisieFormulaire): Promise<{ message: string }> {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const donnees = saisieValide.safeParse(saisie);
  if (!donnees.success) return { message: "Saisie invalide." };
  const { payeurId, ...reste } = donnees.data;
  const resultat = await avecEcole(ecoleId, async (tx) => {
    const saison = await saisonCourante(tx, aujourdhuiAParis());
    if (!saison) return { ok: false as const, message: MESSAGE_SANS_SAISON };
    return enregistrerInscription(tx, payeurId, saison.id, reste);
  });
  if (!resultat.ok) return { message: resultat.message };
  redirect(`/personnes/${payeurId}?inscription=enregistree`);
}
