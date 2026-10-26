import type { Metadata } from "next";
import { isKeyOf } from "@/lib/has";
import { BANNERS } from "./banners";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function SignInPage({ searchParams }: PageProps<"/connexion">) {
  const { lien } = await searchParams;
  // isKeyOf: an inherited key (`?lien=__proto__`) is not a banner.
  const banner = typeof lien === "string" && isKeyOf(BANNERS, lien) ? BANNERS[lien] : undefined;
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
