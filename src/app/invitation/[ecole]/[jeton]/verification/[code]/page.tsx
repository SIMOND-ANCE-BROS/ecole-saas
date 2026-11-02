import { Button, Text, Title } from "@mantine/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { openEmailProof, openLink } from "@/lib/invitations";
import { submitEmailProof } from "../../actions";
import { LinkForm } from "../../link-form";

// no-referrer: both tokens are in the path; they must not follow a click to another site.
export const metadata: Metadata = {
  title: "Rejoindre l’école",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Link e-mailed to the invited address (#179). Opening it changes nothing
 * (mail scanners open links too): the address is marked verified only when
 * the person chooses the account's password and joins the school.
 */
export default async function EmailProofPage({ params }: PageProps<"/invitation/[ecole]/[jeton]/verification/[code]">) {
  const { ecole, jeton, code } = await params;
  if (!z.uuid().safeParse(ecole).success) notFound();
  const link = await openEmailProof(ecole, jeton, code);
  if (!link) {
    // The invitation itself is dead: the shared « lien plus valable » page.
    if (!(await openLink(ecole, jeton))) notFound();
    // Only this e-mail is: replaced by a newer one, or more than an hour old. The person fixes it alone.
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-3 p-6">
        <Title order={1} size="h2">
          Ce lien de confirmation a expiré
        </Title>
        <Text size="sm" c="dimmed">
          Il a plus d’une heure, ou un e-mail plus récent l’a remplacé. Ouvrez le dernier e-mail reçu, ou revenez à
          votre invitation pour en recevoir un nouveau.
        </Text>
        <Button component="a" href={`/invitation/${ecole}/${jeton}`} className="self-start" autoFocus>
          Revenir à l’invitation
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <LinkForm
        action={submitEmailProof.bind(null, ecole, jeton, code)}
        kind="proof"
        email={link.email}
        name={link.name}
        intro={
          <div className="flex flex-col gap-2">
            <Title order={1} size="h2">
              Rejoindre {link.school}
            </Title>
            <Text size="sm" c="dimmed">
              {`C’est bien votre adresse (${link.email}). Choisissez le mot de passe de votre compte : il remplace l’ancien, et vous serez déconnecté(e) sur vos autres appareils.`}
            </Text>
          </div>
        }
      />
    </main>
  );
}
