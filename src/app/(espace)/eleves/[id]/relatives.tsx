"use client";

import { Anchor, Badge, Button, Checkbox, Paper, Text, Title } from "@mantine/core";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { StudentRelative } from "@/db/students";
import { ofName } from "@/lib/french";
import { type Choice, PersonChoice, toInput } from "../../_people/person-choice";
import { Telephone } from "../../_people/sections";
import { addGuardianAction, notify, removeRelative } from "../actions";

type Props = { studentId: string; firstName: string; guardians: StudentRelative[]; other: StudentRelative[] };

function nature(p: StudentRelative, firstName: string): string {
  if (p.direction === "outgoing")
    return p.relation === "legal_guardian"
      ? `${firstName} en est responsable`
      : p.relation === "partner"
        ? "Conjoint"
        : "Proche";
  return p.relation === "legal_guardian" ? "Responsable légal" : p.relation === "partner" ? "Conjoint" : "Proche";
}

/** The student's guardians and relatives: « à prévenir », remove, add a guardian. */
export function Relatives({ studentId: studentId, firstName: firstName, guardians: guardians, other: other }: Props) {
  const [addition, setAddition] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [toNotify, setToNotify] = useState(true);
  const [toRemove, setToRemove] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();

  const act = (action: () => Promise<{ message: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) after?.();
    });

  const row = (p: StudentRelative) => (
    <li key={p.relationshipId} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <Anchor component={Link} href={`/personnes/${p.id}`} size="sm" fw={500}>
          {p.name}
        </Anchor>
        <Text span size="xs" c="dimmed">
          {nature(p, firstName)}
        </Text>
        {p.paysFor && p.direction === "incoming" && (
          <Badge variant="light" size="sm" radius="sm" tt="none" fw={400}>
            payeur
          </Badge>
        )}
        {p.telephone && (
          <span className="ml-auto">
            <Telephone number={p.telephone} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {p.direction === "incoming" && (
          <Checkbox
            size="sm"
            label="À prévenir en cas d’urgence"
            checked={p.toNotify}
            disabled={inProgress}
            onChange={(e) => act(() => notify(studentId, p.relationshipId, e.currentTarget.checked))}
          />
        )}
        {toRemove === p.relationshipId ? (
          <span className="flex items-center gap-2">
            <Button
              size="compact-xs"
              variant="outline"
              color="red"
              disabled={inProgress}
              onClick={() =>
                act(
                  () => removeRelative(studentId, p.relationshipId),
                  () => setToRemove(null),
                )
              }
            >
              Retirer {p.name} de la fiche
            </Button>
            <Anchor component="button" type="button" size="xs" onClick={() => setToRemove(null)}>
              Annuler
            </Anchor>
          </span>
        ) : (
          <Anchor
            component="button"
            type="button"
            size="xs"
            c="dimmed"
            ml="auto"
            onClick={() => setToRemove(p.relationshipId)}
          >
            Retirer
          </Anchor>
        )}
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="responsables" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <Title order={2} size="h5" id="responsables">
            Responsables
          </Title>
          {!addition && (
            <Anchor component="button" type="button" size="sm" onClick={() => setAddition(true)}>
              Ajouter un responsable
            </Anchor>
          )}
        </div>
        {guardians.length === 0 && !addition && (
          <Text size="sm" c="dimmed">
            Aucun responsable indiqué.
          </Text>
        )}
        {guardians.length > 0 && (
          <Paper withBorder component="ul" className="divide-y divide-bordure">
            {guardians.map(row)}
          </Paper>
        )}
        {addition && (
          <Paper withBorder p="sm" className="flex flex-col gap-3 text-sm">
            <PersonChoice
              id="nouveau-responsable"
              label={`Responsable légal ${ofName(firstName)} (parent, tuteur)`}
              value={choice}
              onChange={setChoice}
              exclude={[studentId]}
            />
            <Checkbox
              label="À prévenir en cas d’urgence"
              checked={toNotify}
              onChange={(e) => setToNotify(e.currentTarget.checked)}
            />
            <div className="flex gap-2">
              <Button
                disabled={inProgress || !choice}
                onClick={() =>
                  choice &&
                  act(
                    () => addGuardianAction(studentId, toInput(choice), toNotify),
                    () => {
                      setAddition(false);
                      setChoice(null);
                    },
                  )
                }
              >
                Ajouter
              </Button>
              <Button variant="default" onClick={() => setAddition(false)}>
                Annuler
              </Button>
            </div>
          </Paper>
        )}
      </section>

      {other.length > 0 && (
        <section aria-labelledby="proches" className="flex flex-col gap-2">
          <Title order={2} size="h5" id="proches">
            Autres proches
          </Title>
          <Paper withBorder component="ul" className="divide-y divide-bordure">
            {other.map(row)}
          </Paper>
        </section>
      )}

      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </div>
  );
}
