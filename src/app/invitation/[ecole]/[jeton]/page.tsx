import { Text, Title } from "@mantine/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { openLink } from "@/lib/invitations";
import { submitLink } from "./actions";
import { LinkForm } from "./link-form";

// no-referrer: the token is in the path; it must not follow a click to another site.
export const metadata: Metadata = {
  title: "Accès à l’école",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Invitation or reset link (#104), opened without being signed in: the
 * person creates their access, joins with an existing account, or chooses a
 * new password.
 */
export default async function LinkPage({ params }: PageProps<"/invitation/[ecole]/[jeton]">) {
  const { ecole, jeton } = await params;
  if (!z.uuid().safeParse(ecole).success) notFound();
  const link = await openLink(ecole, jeton);
  if (!link) notFound();
  const kind = link.type === "reset" ? "reset" : link.existingAccount ? "existing" : "new";
  const intro = {
    new: `Vous êtes invité(e) à rejoindre ${link.school}. Choisissez votre mot de passe pour ${link.email}.`,
    existing: `Vous êtes invité(e) à rejoindre ${link.school}. Vous avez déjà un compte (${link.email}) : confirmez avec votre mot de passe actuel.`,
    reset: `Choisissez un nouveau mot de passe pour ${link.email} (${link.school}). Vous serez déconnecté(e) sur vos autres appareils.`,
  }[kind];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <Title order={1} size="h2">
          {kind === "reset" ? "Nouveau mot de passe" : "Créer votre accès"}
        </Title>
        <Text size="sm" c="dimmed">
          {intro}
        </Text>
      </div>
      <LinkForm action={submitLink.bind(null, ecole, jeton)} kind={kind} email={link.email} name={link.name} />
    </main>
  );
}
