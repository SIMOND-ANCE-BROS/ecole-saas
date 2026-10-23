import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { withSchool } from "@/db";
import { school } from "@/db/schema";
import { schoolContext, currentSession } from "@/lib/session";
import { signOut } from "./actions";
import { Frame } from "./frame";
import { Navigation, GlobalSearch } from "./navigation";

const ROLE_LABEL = { direction: "Direction", accueil: "Accueil", professeur: "Professeur" } as const;

/**
 * Cadre de l'espace connecté : barre latérale (école, navigation, compte) et
 * recherche globale. Il n'affiche que des informations : chaque page et chaque
 * action refait sa propre vérification (schoolContext), un layout n'étant pas
 * réexécuté à chaque navigation. `modal` : panneau latéral des routes
 * interceptées (`@modal`), vide le reste du temps.
 */
export default async function WorkspaceLayout({ children, modal }: LayoutProps<"/">) {
  const [{ schoolId: schoolId, role }, { user }] = await Promise.all([schoolContext(), currentSession()]);
  const [{ name: name }] = await withSchool(schoolId, (tx) =>
    tx.select({ name: school.name }).from(school).where(eq(school.id, schoolId)),
  );

  return (
    <Frame
      header={
        // useSearchParams exige une frontière Suspense.
        <Suspense>{role !== "professeur" && <GlobalSearch />}</Suspense>
      }
      pane={
        <>
          <div className="flex items-center gap-2 px-1">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-sm font-semibold text-sur-accent"
            >
              {name.charAt(0)}
            </span>
            <span className="text-sm leading-tight font-semibold">{name}</span>
          </div>
          <Navigation role={role} />
          <div className="mt-auto flex flex-col gap-1 border-t border-bordure pt-3 text-sm">
            <span className="px-1 font-medium">{user.name}</span>
            <span className="px-1 text-xs text-doux">{ROLE_LABEL[role]}</span>
            <Link href="/ecoles" className="lien px-1 text-xs">
              Changer d’école
            </Link>
            <form action={signOut}>
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
    </Frame>
  );
}
