import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Button, Paper, Text, TextInput, Title } from "@mantine/core";
import { z } from "zod";
import { PROVIDERS, credentials, PROVIDER_NAME } from "@/connectors/calendar/oauth";
import { withSchool } from "@/db";
import { tokenInstructor } from "@/db/calendar-feed";
import { connectionState } from "@/db/calendar-connections";
import { publicAddress } from "@/lib/public-calendar";
import { DisconnectButton } from "./disconnect-button";

export const metadata: Metadata = { title: "Mon agenda", robots: { index: false, follow: false } };

const BANNERS: Record<string, { text: string; error: boolean }> = {
  connecte: { text: "Agenda connecté : vos indisponibilités sont transmises à l’école.", error: false },
  refuse: { text: "Connexion annulée : rien n’a été transmis.", error: true },
  erreur: { text: "La connexion n’a pas abouti. Réessayez dans quelques minutes.", error: true },
};
const dateTime = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/**
 * An instructor's personal page, opened through their private link (no account):
 * subscription to their lessons and connection of their calendar.
 */
export default async function MyCalendarPage({ params, searchParams }: PageProps<"/mon-agenda/[ecole]/[jeton]">) {
  const [{ ecole, jeton }, { agenda: status }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(ecole).success) notFound();
  const parsed = await withSchool(ecole, async (tx) => {
    const i = await tokenInstructor(tx, jeton);
    return i ? { instructor: i, connection: await connectionState(tx, i.id) } : null;
  });
  if (!parsed) notFound();
  const { instructor: instructor, connection: connection } = parsed;
  const ics = `${publicAddress()}/agenda/${ecole}/${jeton}.ics`;
  const banner = typeof status === "string" ? BANNERS[status] : undefined;
  const available = PROVIDERS.filter((f) => credentials(f));

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4 sm:p-8">
      <header>
        <Text size="sm" c="dimmed">
          {instructor.school}
        </Text>
        <Title order={1} fz="xl">
          Bonjour {instructor.firstName}
        </Title>
        <Text size="sm" c="dimmed">
          Cette page vous est personnelle : ne partagez pas son adresse.
        </Text>
      </header>

      {banner && (
        <Alert role={banner.error ? "alert" : "status"} color={banner.error ? "yellow" : undefined}>
          {banner.text}
        </Alert>
      )}

      <Paper withBorder component="section" aria-labelledby="seances" p="md" className="flex flex-col gap-2 text-sm">
        <Title order={2} size="h5" id="seances">
          Mes séances dans mon agenda
        </Title>
        <p>
          Ajoutez une fois ce lien à votre agenda : cours, remplacements et annulations s’y mettent à jour d’eux-mêmes.
        </p>
        <Button component="a" href={ics.replace(/^https?:/, "webcal:")} className="self-start">
          S’abonner à mes séances
        </Button>
        <TextInput
          id="ics"
          label="Ou copiez l’adresse :"
          readOnly
          value={ics}
          ff="monospace"
          size="xs"
          styles={{ label: { fontWeight: 400, color: "var(--mantine-color-dimmed)" } }}
        />
      </Paper>

      <Paper withBorder component="section" aria-labelledby="dispo" p="md" className="flex flex-col gap-2 text-sm">
        <Title order={2} size="h5" id="dispo">
          Mes indisponibilités
        </Title>
        <p>
          Connectez votre agenda pour que l’école voie quand vous n’êtes pas disponible, sans rien d’autre : ni titre,
          ni lieu, ni participant. Cela évite qu’on vous propose un cours ou un remplacement à ces moments-là.
        </p>
        {connection ? (
          <>
            <p className="font-medium">
              Connecté à {PROVIDER_NAME[connection.provider]}
              {connection.account && ` (${connection.account})`}.
            </p>
            {connection.error ? (
              <Text size="sm" c="var(--mantine-color-yellow-light-color)">
                {connection.error}
              </Text>
            ) : (
              connection.lastSyncedAt && (
                <Text size="sm" c="dimmed">
                  Dernière mise à jour le {dateTime.format(connection.lastSyncedAt)}.
                </Text>
              )
            )}
            <DisconnectButton schoolId={ecole} token={jeton} />
          </>
        ) : available.length === 0 ? (
          <Text size="sm" c="dimmed">
            La connexion des agendas n’est pas encore ouverte. Prévenez l’école de vos absences.
          </Text>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((f) => (
              <Button key={f} component="a" href={`/mon-agenda/${ecole}/${jeton}/connecter/${f}`} variant="default">
                Connecter {PROVIDER_NAME[f]}
              </Button>
            ))}
          </div>
        )}
      </Paper>
    </main>
  );
}
