import { Button, Text, Title } from "@mantine/core";

/** An invitation or reset link that is used, revoked, expired or mistyped. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-3 p-6">
      {/* Nested not-found files cannot export metadata; notFound() already adds noindex. */}
      <title>Lien non valable · Gestion d’école de danse</title>
      <Title order={1} size="h2">
        Ce lien n’est plus valable
      </Title>
      <Text size="sm" c="dimmed">
        Il a déjà servi, a été révoqué ou a expiré. Demandez un nouveau lien à la direction de l’école.
      </Text>
      {/* Someone who already finished only needs to sign in. */}
      <Button component="a" href="/connexion" variant="default" className="self-start">
        Se connecter
      </Button>
    </main>
  );
}
