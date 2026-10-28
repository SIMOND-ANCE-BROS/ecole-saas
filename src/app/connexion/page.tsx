import type { Metadata } from "next";
import { Alert, Title } from "@mantine/core";
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
      <Title order={1} size="h2">
        Connexion
      </Title>
      {banner && <Alert role="status">{banner}</Alert>}
      <SignInForm />
    </main>
  );
}
