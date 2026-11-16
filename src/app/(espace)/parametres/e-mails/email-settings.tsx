"use client";

import { Alert, Button, Checkbox, Paper, PasswordInput, Radio, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useRef, useState, useTransition } from "react";
import { type EmailSetting, KEY_REQUIRED } from "@/db/email-connectors";
import {
  API_KEY_MAX,
  EMAIL_PROVIDER_DETAILS,
  EMAIL_PROVIDER_LABELS,
  EMAIL_PROVIDER_VALUES,
  type EmailProvider,
  FROM_NAME_MAX,
} from "@/domain/email/settings";
import { settle } from "@/lib/action-result";
import { ConfirmRemoval, type Removal } from "../../_ui/confirm-removal";
import { FormPage } from "../../_ui/form-page";
import { removeEmailSettings, saveEmailSettings, sendTestEmail } from "./actions";

type Entry = { provider: EmailProvider; fromAddress: string; fromName: string; apiKey: string; active: boolean };

/**
 * The school's own e-mail account (#105): provider, sender and API key. The
 * saved key is never sent back to the browser: left empty, it is kept.
 */
export function EmailSettings({
  setting,
  route,
  routeOk,
  me,
}: {
  setting: EmailSetting | null;
  /** Where e-mails go out from now, in French. */
  route: string;
  routeOk: boolean;
  /** The director's own address, where the test e-mail goes. */
  me: string;
}) {
  const [entry, setEntry] = useState<Entry>(() => ({
    provider: setting?.provider ?? "brevo",
    fromAddress: setting?.fromAddress ?? "",
    fromName: setting?.fromName ?? "",
    apiKey: "",
    active: setting?.active ?? true,
  }));
  const [message, setMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [inProgress, startTransition] = useTransition();
  const [testing, startTest] = useTransition();
  // Bumped after a save or a removal: the unsaved-input guard starts again from what was saved.
  const [saves, setSaves] = useState(0);
  const keyField = useRef<HTMLInputElement>(null);
  // A new provider needs its own key: the saved one belongs to the other.
  const keySaved = setting !== null && setting.provider === entry.provider;
  const change = (patch: Partial<Entry>) => setEntry((e) => ({ ...e, ...patch }));

  return (
    <FormPage key={saves} className="flex max-w-2xl flex-col gap-6">
      <Alert color={routeOk ? undefined : "yellow"} variant="light" role="status" title="Envoi actuel">
        {route}
        {setting && !setting.active && (
          <>
            {" "}
            Le compte {EMAIL_PROVIDER_LABELS[setting.provider]} de l’école est enregistré mais pas utilisé (case «
            Utiliser ce compte » décochée).
          </>
        )}
      </Alert>

      <section aria-labelledby="essai" className="flex flex-col gap-2">
        <Title order={2} size="h4" id="essai">
          Tester l’envoi
        </Title>
        <Text size="sm" c="dimmed">
          Un e-mail d’essai part vers votre adresse, <span className="wrap-anywhere">{me}</span>, par l’envoi actuel
          ci-dessus (enregistrez d’abord un changement de compte).
        </Text>
        <div>
          <Button
            variant="default"
            loading={testing}
            onClick={() =>
              startTest(async () => {
                const r = await settle(() => sendTestEmail());
                setTestMessage(r.ok ? null : r.message);
                if (r.ok)
                  notifications.show({
                    color: "green",
                    message: r.simulated
                      ? `Mode simulation : l’e-mail d’essai pour ${r.to} n’est pas réellement parti.`
                      : `E-mail d’essai envoyé à ${r.to}.`,
                  });
              })
            }
          >
            Tester l’envoi
          </Button>
        </div>
        {testMessage && (
          <Text role="alert" size="sm" c="red">
            {testMessage}
          </Text>
        )}
      </section>

      <section aria-labelledby="compte" className="flex flex-col gap-2">
        <Title order={2} size="h4" id="compte">
          Compte d’envoi de l’école
        </Title>
        <Text size="sm" c="dimmed">
          Facultatif. Avant d’enregistrer, validez l’adresse d’expédition chez le service choisi (domaine vérifié, SPF
          et DKIM), sinon les e-mails sont refusés ou classés en indésirables. Ces réglages se font chez l’hébergeur du
          nom de domaine de l’école : demandez-les à la personne qui gère votre site ou vos adresses e-mail.
        </Text>
        <Paper
          withBorder
          p="md"
          component="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await settle(() => saveEmailSettings(entry));
              setMessage(r.ok ? null : r.message);
              if (!r.ok && r.message === KEY_REQUIRED) keyField.current?.focus();
              if (r.ok) {
                change({ apiKey: "" });
                setSaves((n) => n + 1);
                notifications.show({ color: "green", message: "Compte d’envoi enregistré." });
              }
            });
          }}
        >
          <Stack gap="md">
            <Radio.Group
              label="Service d’envoi"
              required
              value={entry.provider}
              onChange={(v) => {
                const provider = EMAIL_PROVIDER_VALUES.find((p) => p === v);
                if (provider) change({ provider });
              }}
            >
              <Stack gap="xs" pt="xs">
                {EMAIL_PROVIDER_VALUES.map((p) => (
                  <Radio key={p} value={p} label={EMAIL_PROVIDER_LABELS[p]} description={EMAIL_PROVIDER_DETAILS[p]} />
                ))}
              </Stack>
            </Radio.Group>
            <TextInput
              label="Adresse d’expédition"
              description="Une adresse du domaine validé chez le service, par exemple contact@votre-ecole.fr."
              type="email"
              required
              autoComplete="off"
              maxLength={254}
              value={entry.fromAddress}
              onChange={(e) => change({ fromAddress: e.currentTarget.value })}
            />
            <TextInput
              label="Nom de l’expéditeur"
              description="Ce que la personne voit dans sa boîte de réception, par exemple le nom de l’école."
              required
              autoComplete="off"
              maxLength={FROM_NAME_MAX}
              value={entry.fromName}
              onChange={(e) => change({ fromName: e.currentTarget.value })}
            />
            <PasswordInput
              label="Clé d’API"
              description={
                keySaved
                  ? "Une clé est enregistrée, chiffrée. Laissez vide pour la garder."
                  : `Créée dans le compte ${EMAIL_PROVIDER_LABELS[entry.provider]}, avec le droit d’envoyer des e-mails.`
              }
              required={!keySaved}
              autoComplete="new-password"
              maxLength={API_KEY_MAX}
              value={entry.apiKey}
              onChange={(e) => change({ apiKey: e.currentTarget.value })}
              ref={keyField}
              error={message === KEY_REQUIRED ? message : undefined}
            />
            <Checkbox
              label="Utiliser ce compte"
              description="Décoché, le service d’envoi de l’application reprend, sans effacer ce réglage."
              checked={entry.active}
              onChange={(e) => change({ active: e.currentTarget.checked })}
            />
            {message && message !== KEY_REQUIRED && (
              <Text role="alert" size="sm" c="red">
                {message}
              </Text>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={inProgress}>
                Enregistrer
              </Button>
              {setting && (
                <Button
                  variant="subtle"
                  color="red"
                  disabled={inProgress}
                  onClick={() =>
                    setRemoval({
                      title: "Supprimer le compte d’envoi",
                      body: "La clé d’API enregistrée est effacée. Les e-mails partiront par le service d’envoi de l’application.",
                      run: () =>
                        startTransition(async () => {
                          const r = await settle(() => removeEmailSettings());
                          setMessage(r.ok ? null : r.message);
                          if (r.ok) {
                            setEntry({ provider: "brevo", fromAddress: "", fromName: "", apiKey: "", active: true });
                            setSaves((n) => n + 1);
                            notifications.show({ color: "green", message: "Compte d’envoi supprimé." });
                          }
                        }),
                    })
                  }
                >
                  Supprimer…
                </Button>
              )}
            </div>
          </Stack>
        </Paper>
      </section>
      <ConfirmRemoval removal={removal} onClose={() => setRemoval(null)} />
    </FormPage>
  );
}
