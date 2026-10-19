import type { Metadata } from "next";
import { ecolesDe } from "@/db";
import { sessionCourante } from "@/lib/session";
import { deconnexion } from "../(espace)/actions";
import { choisirEcoleAction } from "./actions";

export const metadata: Metadata = { title: "Choisir une école" };

const LIBELLE_ROLE = { direction: "Direction", accueil: "Accueil", professeur: "Professeur" } as const;

export default async function PageEcoles() {
  const { user } = await sessionCourante();
  const ecoles = await ecolesDe(user.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="titre-page text-2xl">Choisir une école</h1>
      {ecoles.length === 0 ? (
        <p>Votre compte n’est rattaché à aucune école active. Contactez la direction de votre école.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ecoles.map((e) => (
            <li key={e.id}>
              <form action={choisirEcoleAction}>
                <input type="hidden" name="ecoleId" value={e.id} />
                <button type="submit" className="bouton-secondaire flex w-full justify-between">
                  <span>{e.nom}</span>
                  <span className="text-doux">{LIBELLE_ROLE[e.role]}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={deconnexion}>
        <button type="submit" className="text-sm underline">
          Se déconnecter
        </button>
      </form>
    </main>
  );
}
