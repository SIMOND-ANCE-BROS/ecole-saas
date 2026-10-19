import Link from "next/link";
import { eq } from "drizzle-orm";
import { avecEcole } from "@/db";
import { ecole } from "@/db/schema";
import { contexteEcole } from "@/lib/session";
import { deconnexion } from "./actions";

/**
 * Cadre de l'espace connecté. Il n'affiche que le nom de l'école : chaque page
 * et chaque action refait sa propre vérification (contexteEcole), un layout
 * n'étant pas réexécuté à chaque navigation.
 */
export default async function LayoutEspace({ children }: LayoutProps<"/">) {
  const { ecoleId } = await contexteEcole();
  const [{ nom }] = await avecEcole(ecoleId, (tx) =>
    tx.select({ nom: ecole.nom }).from(ecole).where(eq(ecole.id, ecoleId)),
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700">
        <span className="font-semibold">{nom}</span>
        <nav aria-label="Navigation principale" className="flex gap-3">
          <Link href="/" className="underline-offset-2 hover:underline">
            Accueil
          </Link>
          <Link href="/familles" className="underline-offset-2 hover:underline">
            Familles
          </Link>
          <Link href="/planning" className="underline-offset-2 hover:underline">
            Planning
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/ecoles" className="underline-offset-2 hover:underline">
            Changer d’école
          </Link>
          <form action={deconnexion}>
            <button type="submit" className="underline-offset-2 hover:underline">
              Se déconnecter
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
