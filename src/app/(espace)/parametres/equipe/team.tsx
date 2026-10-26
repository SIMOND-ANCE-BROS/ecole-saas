"use client";

import { Badge, Button, CopyButton, Select, Table, Text, TextInput, Title } from "@mantine/core";
import { useState, useTransition } from "react";
import type { MemberListItem, PendingInvitation } from "@/db/team";
import type { Role } from "@/domain/team/rules";
import { changeMember, inviteMember, type LinkBack, resetPassword, revoke } from "./actions";

type Member = Omit<MemberListItem, "userId"> & { me: boolean };
type Invitation = Omit<PendingInvitation, "expiresAt"> & { expiresAt: string };

const ROLE_LABELS: Record<Role, string> = { director: "Direction", front_desk: "Accueil", teacher: "Professeur" };
const INVITABLE = [
  { value: "front_desk", label: "Accueil" },
  { value: "director", label: "Direction" },
];
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

/** A link to pass on by hand: shown once, with its validity. */
function ShownLink({ link, validity, onClose }: { link: string; validity: string; onClose: () => void }) {
  return (
    <div role="status" className="panneau flex flex-col gap-2 border-accent p-3 text-sm">
      <p>
        Lien à transmettre à la personne (SMS, e-mail personnel…), valable {validity}. Il ne sera plus affiché ensuite :
        en cas de perte, créez-en un nouveau.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          readOnly
          value={link}
          aria-label="Lien"
          className="min-w-0 flex-1"
          onFocus={(e) => e.currentTarget.select()}
        />
        <CopyButton value={link}>
          {({ copied, copy }) => <Button onClick={copy}>{copied ? "Copié" : "Copier le lien"}</Button>}
        </CopyButton>
        <Button variant="subtle" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </div>
  );
}

export function Team({ members, invitations }: { members: Member[]; invitations: Invitation[] }) {
  const [inProgress, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [shown, setShown] = useState<{ link: string; validity: string; kind: "invitation" | "reset" } | null>(null);
  const [entry, setEntry] = useState({ name: "", email: "", role: "front_desk" });

  const run = (action: () => Promise<{ message: string | null }>) =>
    startTransition(async () => setMessage((await action()).message));
  const withLink = (action: () => Promise<LinkBack>, kind: "invitation" | "reset") =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.ok ? null : r.message);
      if (r.ok) setShown({ link: r.link, validity: kind === "invitation" ? "7 jours" : "24 heures", kind });
    });

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <p role="alert" className="text-sm text-erreur">
          {message}
        </p>
      )}

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
                        data={
                          m.role === "teacher" ? [...INVITABLE, { value: "teacher", label: "Professeur" }] : INVITABLE
                        }
                        value={m.role}
                        onChange={(role) => role && run(() => changeMember(m.id, { role, active: m.active }))}
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
                          onClick={() => withLink(() => resetPassword(m.id), "reset")}
                        >
                          Lien de mot de passe
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          color={m.active ? "red" : undefined}
                          disabled={inProgress}
                          onClick={() => run(() => changeMember(m.id, { role: m.role, active: !m.active }))}
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
        {shown?.kind === "reset" && (
          <ShownLink link={shown.link} validity={shown.validity} onClose={() => setShown(null)} />
        )}
      </section>

      <section aria-labelledby="inviter" className="flex flex-col gap-2">
        <Title order={2} size="h4" id="inviter">
          Inviter une personne
        </Title>
        <form
          className="panneau flex flex-wrap items-end gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            withLink(async () => {
              const r = await inviteMember(entry);
              if (r.ok) setEntry({ name: "", email: "", role: entry.role });
              return r;
            }, "invitation");
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
        {shown?.kind === "invitation" && (
          <ShownLink link={shown.link} validity={shown.validity} onClose={() => setShown(null)} />
        )}
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
                <span className="font-medium">{i.name ?? i.email}</span>
                <span className="text-doux">{i.email}</span>
                {i.role && <Badge variant="light">{ROLE_LABELS[i.role]}</Badge>}
                <span className="text-doux">valable jusqu’au {day.format(new Date(i.expiresAt))}</span>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  className="ml-auto"
                  disabled={inProgress}
                  onClick={() => run(() => revoke(i.id))}
                >
                  Révoquer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
