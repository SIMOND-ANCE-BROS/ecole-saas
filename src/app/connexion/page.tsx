import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Connexion" };

/** Banner after an invitation or reset link (`?lien=`, #104). */
const BANNERS: Record<string, string> = {
  acces: "Votre accès est prêt : connectez-vous avec votre e-mail et votre mot de passe.",
  "mot-de-passe": "Mot de passe changé : connectez-vous avec le nouveau.",
};

export default async function SignInPage({ searchParams }: PageProps<"/connexion">) {
  const { lien } = await searchParams;
  const banner = typeof lien === "string" ? BANNERS[lien] : undefined;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="titre-page text-2xl">Connexion</h1>
      {banner && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          {banner}
        </p>
      )}
      <SignInForm />
    </main>
  );
}
