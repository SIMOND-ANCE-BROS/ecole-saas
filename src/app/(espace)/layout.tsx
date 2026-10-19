import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { avecEcole } from "@/db";
import { ecole } from "@/db/schema";
import { contexteEcole, sessionCourante } from "@/lib/session";
import { deconnexion } from "./actions";
import { Navigation, RechercheGlobale } from "./navigation";

const LIBELLE_ROLE = { direction: "Direction", accueil: "Accueil", professeur: "Professeur" } as const;

/**
 * Cadre de l'espace connecté : barre latérale (école, navigation, compte) et
 * recherche globale. Il n'affiche que des informations : chaque page et chaque
 * action refait sa propre vérification (contexteEcole), un layout n'étant pas
 * réexécuté à chaque navigation.
 */
export default async function LayoutEspace({ children }: LayoutProps<"/">) {
  const [{ ecoleId, role }, { user }] = await Promise.all([contexteEcole(), sessionCourante()]);
  const [{ nom }] = await avecEcole(ecoleId, (tx) =>
    tx.select({ nom: ecole.nom }).from(ecole).where(eq(ecole.id, ecoleId)),
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 print:hidden border-b border-bordure bg-surface p-3 md:sticky md:top-0 md:h-screen md:w-52 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-1">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-sm font-semibold text-sur-accent">
            {nom.charAt(0)}
          </span>
          <span className="text-sm leading-tight font-semibold">{nom}</span>
        </div>
        <Navigation />
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
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 print:hidden border-b border-bordure bg-fond/90 px-4 py-2 backdrop-blur">
          {/* useSearchParams exige une frontière Suspense. */}
          <Suspense>
            <RechercheGlobale />
          </Suspense>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
