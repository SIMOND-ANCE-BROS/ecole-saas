import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Connexion" };

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="titre-page text-2xl">Connexion</h1>
      <SignInForm />
    </main>
  );
}
