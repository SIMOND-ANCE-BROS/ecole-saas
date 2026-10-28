"use client";

import { Button, Group, List, Paper, Text, TextInput, Title } from "@mantine/core";
import { useState, useTransition } from "react";
import { createCalendarLink, disconnectCalendar, revokeCalendarLink, syncNow } from "../actions";
import { has } from "@/lib/has";

const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/**
 * Subscription link to the instructor's calendar. The address is shown only when
 * created (only its hash is kept): recreating it replaces the old one.
 */
type Connection = { provider: string; account: string | null; lastSyncedAt: string | null; error: string | null };

export function CalendarSubscription({
  instructorId: instructorId,
  firstName: firstName,
  activeSince: activeSince,
  connection: connection,
}: {
  instructorId: string;
  firstName: string;
  activeSince: string | null;
  connection: Connection | null;
}) {
  const [url, setUrl] = useState<{ url: string; page: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copy, setCopy] = useState(false);
  const [inProgress, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      const r = await createCalendarLink(instructorId);
      if (has(r, "url")) {
        setUrl(r);
        setMessage(null);
        setCopy(false);
      } else setMessage(r.message);
    });

  return (
    <Paper
      withBorder
      p="md"
      component="section"
      aria-labelledby="agenda"
      className="flex w-full min-w-0 flex-col gap-3"
    >
      <div>
        <Title order={2} size="h5" id="agenda">
          Agenda de {firstName}
        </Title>
        <Text size="sm" c="dimmed">
          Une page privée pour {firstName} : s’abonner à ses séances (Google, Apple, Outlook) et connecter son agenda
          pour que ses indisponibilités remontent ici. Aucun nom d’élève n’en sort ; seules ses plages occupées y
          entrent.
        </Text>
      </div>

      {url ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <TextInput
              label={`Page à transmettre à ${firstName} (affichée une seule fois)`}
              readOnly
              className="min-w-0 flex-1"
              styles={{
                input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: "var(--mantine-font-size-xs)" },
              }}
              value={url.page}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="default"
              className="shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(url.page);
                setCopy(true);
              }}
            >
              {copy ? "Copié" : "Copier"}
            </Button>
          </div>
          <Text size="sm" c="dimmed">
            Abonnement direct, sans la page :{" "}
            <Text span ff="monospace" size="xs" className="break-all">
              {url.url}
            </Text>
          </Text>
          <List size="sm" c="dimmed" listStyleType="disc" withPadding>
            <List.Item>
              Google Agenda (ordinateur) : « Autres agendas », « + », « À partir de l’URL », puis coller le lien.
            </List.Item>
            <List.Item>
              iPhone : Réglages, Calendrier, Comptes, « Ajouter un compte », « Autre », « Ajouter un calendrier avec
              abonnement ».
            </List.Item>
            <List.Item>Outlook : « Ajouter un calendrier », « S’abonner à partir du web ».</List.Item>
          </List>
          <Text size="sm" c="dimmed">
            Les agendas se mettent à jour toutes les quelques heures (selon l’application).
          </Text>
        </div>
      ) : (
        <Text size="sm">
          {activeSince
            ? `Lien actif depuis le ${shortDate.format(new Date(activeSince))}.`
            : "Aucun lien pour l’instant."}
        </Text>
      )}

      {connection ? (
        <Paper withBorder p="sm" className="flex flex-col gap-1">
          <Text size="sm">
            Agenda connecté : {connection.provider}
            {connection.account && ` (${connection.account})`}.
          </Text>
          {connection.error ? (
            <Text size="sm" c="red">
              {connection.error}
            </Text>
          ) : (
            connection.lastSyncedAt && (
              <Text size="sm" c="dimmed">
                Dernière mise à jour : {dateTime.format(new Date(connection.lastSyncedAt))}.
              </Text>
            )
          )}
          <Group gap="xs" mt="xs">
            <Button
              variant="default"
              disabled={inProgress}
              onClick={() => startTransition(async () => setMessage((await syncNow(instructorId)).message))}
            >
              Synchroniser maintenant
            </Button>
            <Button
              variant="default"
              disabled={inProgress}
              onClick={() => startTransition(async () => setMessage((await disconnectCalendar(instructorId)).message))}
            >
              Déconnecter
            </Button>
          </Group>
        </Paper>
      ) : (
        activeSince && (
          <Text size="sm" c="dimmed">
            Aucun agenda connecté par {firstName} pour l’instant.
          </Text>
        )
      )}

      {message && (
        <Text role="status" size="sm" fw={500}>
          {message}
        </Text>
      )}

      <Group gap="xs">
        <Button disabled={inProgress} onClick={create}>
          {activeSince || url ? "Remplacer le lien" : "Créer le lien"}
        </Button>
        {(activeSince || url) && (
          <Button
            variant="default"
            disabled={inProgress}
            onClick={() =>
              startTransition(async () => {
                const r = await revokeCalendarLink(instructorId);
                setMessage(r.message);
                if (!r.message) setUrl(null);
              })
            }
          >
            Révoquer
          </Button>
        )}
      </Group>
      {(activeSince || url) && (
        <Text size="xs" c="dimmed">
          Remplacer ou révoquer le lien coupe aussitôt l’ancien abonnement.
        </Text>
      )}
    </Paper>
  );
}
