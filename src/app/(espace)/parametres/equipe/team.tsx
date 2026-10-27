"use client";

import { Badge, Button, CopyButton, Group, Modal, Paper, Select, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useRef, useState, useTransition } from "react";
import type { MemberListItem, PendingInvitation } from "@/db/team";
import { INVITABLE_ROLES, ROLE_LABELS, type Role } from "@/domain/team/rules";
import { type Back, changeMember, inviteMember, type LinkBack, resetPassword, revoke } from "./actions";

type Member = Omit<MemberListItem, "userId"> & { me: boolean };
type Invitation = Omit<PendingInvitation, "expiresAt"> & { expiresAt: string };
/** Where a refusal is shown: next to what the user just did. */
type Section = "members" | "invite" | "invitations";
type Shown = { link: string; who: string; kind: "invitation" | "reset" };
/** A change that needs a « yes » first (DESIGN.md: destructive actions ask for confirmation). */
type Pending = {
  title: string;
  body: string;
  verb: string;
  red: boolean;
  section: Section;
  done: string;
  action: () => Promise<Back>;
};

const INVITABLE = INVITABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const ALL_ROLES = [...INVITABLE, { value: "teacher", label: ROLE_LABELS.teacher }];
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

/** A link to pass on by hand: shown once, with who it is for and how long it is valid. */
function ShownLink({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const copyButton = useRef<HTMLButtonElement>(null);
  // Ready to copy with Enter: the link is what the director came for.
  useEffect(() => copyButton.current?.focus(), [shown.link]);
  const validity = shown.kind === "invitation" ? "7 jours" : "24 heures";
  return (
    <Paper withBorder role="status" p="sm" className="flex flex-col gap-2 border-accent text-sm">
      <p>
        <strong>
          {shown.kind === "invitation" ? "Invitation de" : "Nouveau mot de passe pour"} {shown.who}
        </strong>{" "}
        : lien à lui transmettre (SMS, e-mail personnel…), valable {validity}. La personne y choisira elle-même son mot
        de passe. Le lien ne sera plus affiché ensuite : en cas de perte, créez-en un nouveau.
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
          {({ copied, copy }) => (
            <Button ref={copyButton} onClick={copy}>
              {copied ? "Copié" : "Copier le lien"}
            </Button>
          )}
        </CopyButton>
        <Button variant="subtle" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </Paper>
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
  const [pending, setPending] = useState<Pending | null>(null);
  const [entry, setEntry] = useState({ name: "", email: "", role: "front_desk" });
  const refusalIn = (s: Section) => (refusal?.section === s ? refusal.text : undefined);

  const confirm = (p: Pending) =>
    startTransition(async () => {
      const r = await p.action();
      setPending(null);
      setRefusal(r.ok ? null : { section: p.section, text: r.message });
      if (r.ok) notifications.show({ message: p.done, color: "green" });
      // A revoked invitation's link no longer works: it is not left on screen to copy.
      if (r.ok && p.section === "invitations" && shown?.kind === "invitation") setShown(null);
    });
  const withLink = (section: Section, action: () => Promise<LinkBack>, kind: Shown["kind"], who: string) =>
    startTransition(async () => {
      const r = await action();
      setRefusal(r.ok ? null : { section, text: r.message });
      setShown(r.ok ? { link: r.link, who, kind } : null);
    });

  const askRole = (m: Member, role: Role) =>
    setPending({
      title: "Changer le rôle",
      body: `${m.name} passera de « ${ROLE_LABELS[m.role]} » à « ${ROLE_LABELS[role]} ».`,
      verb: "Changer le rôle",
      red: false,
      section: "members",
      done: `Rôle de ${m.name} changé`,
      action: () => changeMember(m.id, { role, active: m.active }),
    });
  const askActive = (m: Member) =>
    setPending(
      m.active
        ? {
            title: "Désactiver l’accès",
            body: `${m.name} ne pourra plus se connecter à l’école. Vous pourrez réactiver son accès plus tard.`,
            verb: "Désactiver",
            red: true,
            section: "members",
            done: `Accès de ${m.name} désactivé`,
            action: () => changeMember(m.id, { role: m.role, active: false }),
          }
        : {
            title: "Réactiver l’accès",
            body: `${m.name} pourra de nouveau se connecter, avec le rôle « ${ROLE_LABELS[m.role]} ».`,
            verb: "Réactiver",
            red: false,
            section: "members",
            done: `Accès de ${m.name} réactivé`,
            action: () => changeMember(m.id, { role: m.role, active: true }),
          },
    );
  const askRevoke = (i: Invitation) =>
    setPending({
      title: "Révoquer l’invitation",
      body: `Le lien envoyé à ${i.name ?? i.email} ne fonctionnera plus.`,
      verb: "Révoquer",
      red: true,
      section: "invitations",
      done: "Invitation révoquée",
      action: () => revoke(i.id),
    });

  const roleControl = (m: Member) =>
    m.me ? (
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
        onChange={(role) => role && role !== m.role && askRole(m, role as Role)}
      />
    );
  const memberActions = (m: Member) =>
    !m.me && (
      <div className="flex flex-wrap gap-1 sm:justify-end">
        {m.active && (
          <Button
            size="compact-sm"
            variant="subtle"
            disabled={inProgress}
            onClick={() => withLink("members", () => resetPassword(m.id), "reset", m.name)}
          >
            Créer un lien de mot de passe
          </Button>
        )}
        <Button
          size="compact-sm"
          variant="subtle"
          color={m.active ? "red" : undefined}
          disabled={inProgress}
          onClick={() => askActive(m)}
        >
          {m.active ? "Désactiver…" : "Réactiver…"}
        </Button>
      </div>
    );
  const badges = (m: Member) => (
    <>
      {m.me && <Badge variant="light">vous</Badge>}{" "}
      {!m.active && (
        <Badge color="gray" variant="light">
          désactivé
        </Badge>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <Modal opened={pending !== null} onClose={() => setPending(null)} title={pending?.title} centered>
        <Text size="sm">{pending?.body}</Text>
        <Group justify="flex-end" mt="md">
          {/* A destructive change starts on « Annuler »: Enter by reflex must not cut someone off. */}
          <Button variant="default" onClick={() => setPending(null)} data-autofocus={pending?.red ? true : undefined}>
            Annuler
          </Button>
          <Button
            color={pending?.red ? "red" : undefined}
            loading={inProgress}
            onClick={() => pending && confirm(pending)}
            data-autofocus={pending?.red ? undefined : true}
          >
            {pending?.verb}
          </Button>
        </Group>
      </Modal>

      <section aria-labelledby="membres" className="flex flex-col gap-2">
        <Title order={2} size="h4" id="membres">
          Membres
        </Title>
        {/* Desktop: a table. Phone: one card per member, actions on their own line (no horizontal scroll). */}
        <Paper withBorder className="relative hidden overflow-x-auto sm:block">
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
                    {m.name} {badges(m)}
                  </Table.Td>
                  <Table.Td>{m.email}</Table.Td>
                  <Table.Td>{roleControl(m)}</Table.Td>
                  <Table.Td>{memberActions(m)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
        <Paper withBorder component="ul" className="divide-y divide-bordure text-sm sm:hidden">
          {members.map((m) => (
            <li key={m.id} className={`flex flex-col gap-1.5 px-3 py-2.5 ${m.active ? "" : "text-doux"}`}>
              <span className="font-medium">
                {m.name} {badges(m)}
              </span>
              <span className="break-all text-doux">{m.email}</span>
              <span>{roleControl(m)}</span>
              {memberActions(m)}
            </li>
          ))}
        </Paper>
        <Refusal text={refusalIn("members")} />
        {shown?.kind === "reset" && <ShownLink shown={shown} onClose={() => setShown(null)} />}
      </section>

      <section aria-labelledby="inviter" className="flex flex-col gap-2">
        <Title order={2} size="h4" id="inviter">
          Inviter une personne
        </Title>
        <Paper
          withBorder
          component="form"
          p="md"
          noValidate
          className="flex flex-wrap items-end gap-3"
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
          <Button type="submit" variant={shown?.kind === "invitation" ? "default" : "filled"} loading={inProgress}>
            Créer le lien d’invitation
          </Button>
        </Paper>
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
          <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                {i.name && <span className="font-medium">{i.name}</span>}
                <span className={i.name ? "break-all text-doux" : "break-all font-medium"}>{i.email}</span>
                {i.role && <Badge variant="light">{ROLE_LABELS[i.role]}</Badge>}
                <span className="text-doux">valable jusqu’au {day.format(new Date(i.expiresAt))}</span>
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="red"
                  className="ml-auto"
                  disabled={inProgress}
                  onClick={() => askRevoke(i)}
                >
                  Révoquer…
                </Button>
              </li>
            ))}
          </Paper>
        )}
        <Refusal text={refusalIn("invitations")} />
      </section>
    </div>
  );
}
