import { Text, Title } from "@mantine/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { openEmailProof } from "@/lib/invitations";
import { submitEmailProof } from "../../actions";
import { LinkForm } from "../../link-form";

// no-referrer: both tokens are in the path; they must not follow a click to another site.
export const metadata: Metadata = {
  title: "Confirmer votre adresse e-mail",
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
  if (!link) notFound();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <Title order={1} size="h2">
          Rejoindre {link.school}
        </Title>
        <Text size="sm" c="dimmed">
          {`Adresse ${link.email} confirmée. Choisissez le mot de passe de votre compte : il remplace l’ancien, et vous serez déconnecté(e) sur vos autres appareils.`}
        </Text>
      </div>
      <LinkForm
        action={submitEmailProof.bind(null, ecole, jeton, code)}
        kind="proof"
        email={link.email}
        name={link.name}
      />
    </main>
  );
}
