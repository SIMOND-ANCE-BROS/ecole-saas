import { Button, Text, Title } from "@mantine/core";

/** A page or record that does not exist in the school: deleted student, missing parameter… */
export default function NotFound() {
  return (
    <section className="flex flex-col items-start gap-3">
      {/* Nested not-found files cannot export metadata: React hoists this title into <head>. */}
      <title>Page introuvable · Gestion d’école de danse</title>
      <Title order={1} size="h2">
        Page introuvable
      </Title>
      <Text size="sm" c="dimmed">
        Cette page n’existe pas ou la fiche a été supprimée. Cherchez l’élève ou le contact avec la barre de recherche
        (Ctrl K).
      </Text>
      <Button component="a" href="/">
        Retour à l’accueil
      </Button>
    </section>
  );
}
