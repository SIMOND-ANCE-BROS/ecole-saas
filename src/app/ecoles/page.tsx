import type { Metadata } from "next";
import { schoolsOf } from "@/db";
import { currentSession } from "@/lib/session";
import { signOut } from "../(espace)/actions";
import { chooseSchoolAction } from "./actions";
import { SCHOOL_CHOICE } from "./fields";

export const metadata: Metadata = { title: "Choisir une école" };

const ROLE_LABEL = { director: "Direction", front_desk: "Accueil", teacher: "Professeur" } as const;

export default async function SchoolsPage() {
  const { user } = await currentSession();
  const ecoles = await schoolsOf(user.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="titre-page text-2xl">Choisir une école</h1>
      {ecoles.length === 0 ? (
        <p>Votre compte n’est rattaché à aucune école active. Contactez la direction de votre école.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ecoles.map((e) => (
            <li key={e.id}>
              <form action={chooseSchoolAction}>
                <input type="hidden" name={SCHOOL_CHOICE.name("schoolId")} value={e.id} />
                <button type="submit" className="bouton-secondaire flex w-full justify-between">
                  <span>{e.name}</span>
                  <span className="text-doux">{ROLE_LABEL[e.role]}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={signOut}>
        <button type="submit" className="text-sm underline">
          Se déconnecter
        </button>
      </form>
    </main>
  );
}
