import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { avecEcole } from "@/db";
import { ecole } from "@/db/schema";
import { contexteEcole, sessionCourante } from "@/lib/session";
import { deconnexion } from "./actions";
import { Cadre } from "./cadre";
import { Navigation, RechercheGlobale } from "./navigation";

const LIBELLE_ROLE = { direction: "Direction", accueil: "Accueil", professeur: "Professeur" } as const;

/**
 * Cadre de l'espace connecté : barre latérale (école, navigation, compte) et
 * recherche globale. Il n'affiche que des informations : chaque page et chaque
 * action refait sa propre vérification (contexteEcole), un layout n'étant pas
 * réexécuté à chaque navigation. `modal` : panneau latéral des routes
 * interceptées (`@modal`), vide le reste du temps.
 */
export default async function LayoutEspace({ children, modal }: LayoutProps<"/">) {
  const [{ ecoleId, role }, { user }] = await Promise.all([contexteEcole(), sessionCourante()]);
  const [{ nom }] = await avecEcole(ecoleId, (tx) =>
    tx.select({ nom: ecole.nom }).from(ecole).where(eq(ecole.id, ecoleId)),
  );

  return (
    <Cadre
      entete={
        // useSearchParams exige une frontière Suspense.
        <Suspense>{role !== "professeur" && <RechercheGlobale />}</Suspense>
      }
      volet={
        <>
          <div className="flex items-center gap-2 px-1">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-sm font-semibold text-sur-accent"
            >
              {nom.charAt(0)}
            </span>
            <span className="text-sm leading-tight font-semibold">{nom}</span>
          </div>
          <Navigation role={role} />
          <div className="mt-auto flex flex-col gap-1 border-t border-bordure pt-3 text-sm">
            <span className="px-1 font-medium">{user.name}</span>
            <span className="px-1 text-xs text-doux">{LIBELLE_ROLE[role]}</span>
            <Link href="/ecoles" className="lien px-1 text-xs">
              Changer d’école
            </Link>
            <form action={deconnexion}>
              <button type="submit" className="lien px-1 text-xs">
                Se déconnecter
              </button>
            </form>
          </div>
        </>
      }
    >
      {children}
      {modal}
    </Cadre>
  );
}
