"use client";

import { Badge, Button, CopyButton, Select, Table, Text, TextInput, Title } from "@mantine/core";
import { useState, useTransition } from "react";
import type { MemberListItem, PendingInvitation } from "@/db/team";
import { INVITABLE_ROLES, ROLE_LABELS } from "@/domain/team/rules";
import { type Back, changeMember, inviteMember, type LinkBack, resetPassword, revoke } from "./actions";

type Member = Omit<MemberListItem, "userId"> & { me: boolean };
type Invitation = Omit<PendingInvitation, "expiresAt"> & { expiresAt: string };
/** Where a result is shown: next to what the user just did. */
type Section = "members" | "invite" | "invitations";
type Shown = { link: string; who: string; kind: "invitation" | "reset" };

const INVITABLE = INVITABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const ALL_ROLES = [...INVITABLE, { value: "teacher", label: ROLE_LABELS.teacher }];
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

/** A link to pass on by hand: shown once, with who it is for and how long it is valid. */
function ShownLink({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const validity = shown.kind === "invitation" ? "7 jours" : "24 heures";
  return (
    <div role="status" className="panneau flex flex-col gap-2 border-accent p-3 text-sm">
      <p>
        <strong>
          {shown.kind === "invitation" ? "Invitation de" : "Nouveau mot de passe pour"} {shown.who}
        </strong>{" "}
        : lien à lui transmettre (SMS, e-mail personnel…), valable {validity}. Il ne sera plus affiché ensuite : en cas
        de perte, créez-en un nouveau.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          readOnly
          value={shown.link}
          aria-label={`Lien pour ${shown.who}`}
          className="min-w-0 flex-1"
          onFocus={(e) => e.currentTarget.select()}
        />
        <CopyButton value={shown.link}>
          {({ copied, copy }) => <Button onClick={copy}>{copied ? "Copié" : "Copier le lien"}</Button>}
        </CopyButton>
        <Button variant="subtle" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </div>
  );
}

function Refusal({ text }: { text: string | undefined }) {
  return text ? (
    <p role="alert" className="text-sm text-erreur">
      {text}
    </p>
  ) : null;
}

export function Team({ members, invitations }: { members: Member[]; invitations: Invitation[] }) {
  const [inProgress, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<{ section: Section; text: string } | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [entry, setEntry] = useState({ name: "", email: "", role: "front_desk" });
  const refusalIn = (s: Section) => (refusal?.section === s ? refusal.text : undefined);

  const run = (section: Section, action: () => Promise<Back>) =>
    startTransition(async () => {
      const r = await action();
      setRefusal(r.ok ? null : { section, text: r.message });
      // A revoked invitation's link no longer works: it is not left on screen to copy.
      if (section === "invitations") setShown(null);
    });
  const withLink = (section: Section, action: () => Promise<LinkBack>, kind: Shown["kind"], who: string) =>
    startTransition(async () => {
      const r = await action();
      setRefusal(r.ok ? null : { section, text: r.message });
      setShown(r.ok ? { link: r.link, who, kind } : null);
    });

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="membres" className="flex flex-col gap-2">
        <Title order={2} size="h4" id="membres">
          Membres
        </Title>
        <div className="panneau overflow-x-auto">
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nom</Table.Th>
                <Table.Th>E-mail</Table.Th>
                <Table.Th>Rôle</Table.Th>
                <Table.Th>
                  <span className="sr-only">Actions</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.map((m) => (
                <Table.Tr key={m.id} className={m.active ? undefined : "text-doux"}>
                  <Table.Td>
                    {m.name} {m.me && <Badge variant="light">vous</Badge>}{" "}
                    {!m.active && (
                      <Badge color="gray" variant="light">
                        désactivé
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{m.email}</Table.Td>
                  <Table.Td>
                    {m.me ? (
                      ROLE_LABELS[m.role]
                    ) : (
                      <Select
                        aria-label={`Rôle de ${m.name}`}
                        size="xs"
                        w={140}
                        allowDeselect={false}
                        disabled={inProgress}
                        data={m.role === "teacher" ? ALL_ROLES : INVITABLE}
                        value={m.role}
                        onChange={(role) =>
                          role && run("members", () => changeMember(m.id, { role, active: m.active }))
                        }
                      />
                    )}
                  </Table.Td>
                  <Table.Td>
                    {!m.me && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="xs"
                          variant="subtle"
                          disabled={inProgress}
                          onClick={() => withLink("members", () => resetPassword(m.id), "reset", m.name)}
                        >
                          Lien de mot de passe
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          color={m.active ? "red" : undefined}
                          disabled={inProgress}
                          onClick={() => run("members", () => changeMember(m.id, { role: m.role, active: !m.active }))}
                        >
                          {m.active ? "Désactiver" : "Réactiver"}
                        </Button>
                      </div>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
        <Refusal text={refusalIn("members")} />
        {shown?.kind === "reset" && <ShownLink shown={shown} onClose={() => setShown(null)} />}
      </section>

      <section aria-labelledby="inviter" className="flex flex-col gap-2">
        <Title order={2} size="h4" id="inviter">
          Inviter une personne
        </Title>
        <form
          className="panneau flex flex-wrap items-end gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const who = entry.name.trim();
            withLink(
              "invite",
              async () => {
                const r = await inviteMember(entry);
                if (r.ok) setEntry({ name: "", email: "", role: entry.role });
                return r;
              },
              "invitation",
              who,
            );
          }}
        >
          <TextInput
            label="Nom"
            required
            value={entry.name}
            onChange={(e) => setEntry({ ...entry, name: e.currentTarget.value })}
            autoComplete="off"
          />
          <TextInput
            label="E-mail"
            type="email"
            required
            value={entry.email}
            onChange={(e) => setEntry({ ...entry, email: e.currentTarget.value })}
            autoComplete="off"
          />
          <Select
            label="Rôle"
            w={140}
            allowDeselect={false}
            data={INVITABLE}
            value={entry.role}
            onChange={(role) => role && setEntry({ ...entry, role })}
          />
          <Button type="submit" loading={inProgress}>
            Créer le lien d’invitation
          </Button>
        </form>
        <Refusal text={refusalIn("invite")} />
        {shown?.kind === "invitation" && <ShownLink shown={shown} onClose={() => setShown(null)} />}
      </section>

      <section aria-labelledby="invitations" className="flex flex-col gap-2">
        <Title order={2} size="h4" id="invitations">
          Invitations en attente
        </Title>
        {invitations.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucune invitation en attente.
          </Text>
        ) : (
          <ul className="panneau divide-y divide-bordure text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                {i.name && <span className="font-medium">{i.name}</span>}
                <span className={i.name ? "text-doux" : "font-medium"}>{i.email}</span>
                {i.role && <Badge variant="light">{ROLE_LABELS[i.role]}</Badge>}
                <span className="text-doux">valable jusqu’au {day.format(new Date(i.expiresAt))}</span>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  className="ml-auto"
                  disabled={inProgress}
                  onClick={() => run("invitations", () => revoke(i.id))}
                >
                  Révoquer
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Refusal text={refusalIn("invitations")} />
      </section>
    </div>
  );
}
