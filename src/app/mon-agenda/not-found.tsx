import { Text, Title } from "@mantine/core";

/**
 * An instructor's private link that is revoked or mistyped. Instructors have no
 * account: no link to the workspace, which would only lead to the sign-in page.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-3 p-4 sm:p-8">
      {/* Nested not-found files cannot export metadata; notFound() already adds noindex. */}
      <title>Lien non valide · Gestion d’école de danse</title>
      <Title order={1} size="h2">
        Ce lien n’est plus valide
      </Title>
      <Text size="sm" c="dimmed">
        Il a peut-être été remplacé par un nouveau lien, ou mal recopié. Demandez à l’école de vous renvoyer le lien de
        votre agenda.
      </Text>
    </main>
  );
}
