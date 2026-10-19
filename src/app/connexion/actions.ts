"use server";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ecolesDe } from "@/db";
import { choisirEcole, idDeSession } from "@/lib/acces-ecole";
import { auth } from "@/lib/auth";
import { effacerTentatives, enregistrerTentative, ipDeConfiance, LIMITES } from "@/lib/limite-connexion";

export type EtatConnexion = { erreur: string | null; email: string };

const saisie = z.object({
  email: z.email(),
  motDePasse: z.string().min(1),
});

export async function seConnecter(_etat: EtatConnexion, formData: FormData): Promise<EtatConnexion> {
  const email = String(formData.get("email") ?? "");
  const donnees = saisie.safeParse({ email, motDePasse: formData.get("motDePasse") });
  if (!donnees.success) {
    return { erreur: "Saisissez une adresse e-mail valide et votre mot de passe.", email };
  }

  const entetes = await headers();
  // Tentative enregistrée avant la vérification du mot de passe (voir limite-connexion.ts).
  const ip = ipDeConfiance(entetes);
  if (!(await enregistrerTentative(donnees.data.email, ip))) {
    return {
      erreur: `Trop de tentatives de connexion. Réessayez dans ${LIMITES.fenetreMinutes} minutes.`,
      email,
    };
  }

  let connexion;
  try {
    connexion = await auth.api.signInEmail({
      body: { email: donnees.data.email, password: donnees.data.motDePasse },
      headers: entetes,
    });
  } catch (e) {
    // Même message pour un compte inconnu ou un mauvais mot de passe.
    if (isAPIError(e)) return { erreur: "Adresse e-mail ou mot de passe incorrect.", email };
    throw e;
  }
  await effacerTentatives(donnees.data.email, ip);

  // Une seule école : choisie d'office, sans passer par la liste.
  const ecoles = await ecolesDe(connexion.user.id);
  const sessionId = await idDeSession(connexion.token);
  if (ecoles.length === 1 && sessionId && (await choisirEcole(sessionId, connexion.user.id, ecoles[0].id))) {
    redirect("/");
  }
  redirect("/ecoles");
}
