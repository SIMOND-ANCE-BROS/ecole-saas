"use client";

import { Anchor, Button, Paper, Radio, Text, Title } from "@mantine/core";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { StudentRecord, StudentRelative } from "@/db/students";
import { type Choice, PersonChoice, toInput } from "../../_people/person-choice";
import { WARNING } from "../../_people/sections";
import { invoice, billNewPerson } from "../actions";

type Props = {
  studentId: string;
  firstName: string;
  minor: boolean;
  billedTo: StudentRecord["billedTo"];
  /** Relatives who can be invoiced (guardians and relatives « vers » the student). */
  relatives: StudentRelative[];
  siblings: StudentRecord["siblings"];
};

/** « Facturé à »: a single payer, changed in one gesture. */
export function Billing({
  studentId: studentId,
  firstName: firstName,
  minor: minor,
  billedTo,
  relatives: relatives,
  siblings: siblings,
}: Props) {
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState<Choice | null>(null);
  const [seeOther, setSeeOther] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const box = useRef<HTMLElement>(null);
  // Opening and closing swap « Changer » and the choices: focus follows, never back to the page.
  const opened = useRef(open);
  useEffect(() => {
    if (opened.current === open) return;
    opened.current = open;
    const find = (selector: string) => box.current?.querySelector<HTMLElement>(selector);
    (open
      ? (find('input[name="facturer"]:checked') ?? find('input[name="facturer"]'))
      : find("[data-changer]")
    )?.focus();
  }, [open]);

  const choose = (action: () => Promise<{ message: string | null }>) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) {
        setOpen(false);
        setSeeOther(false);
        setOther(null);
      }
    });

  const current =
    billedTo.type === "person" ? billedTo.name : billedTo.type === "self" ? `${firstName} (paie ses cours)` : null;

  return (
    <Paper
      ref={box}
      withBorder
      p="md"
      component="section"
      aria-labelledby="facture-a"
      className="flex flex-col gap-2 text-sm"
    >
      <Title order={2} size="h6" id="facture-a">
        Facturé à
      </Title>
      {current ? (
        <Text fw={500}>
          {billedTo.type === "person" ? (
            <Anchor component={Link} href={`/personnes/${billedTo.id}`} inherit>
              {current}
            </Anchor>
          ) : (
            current
          )}
        </Text>
      ) : (
        <Text role="alert" size="sm" c={WARNING}>
          Personne : {firstName} est mineur, indiquez à qui facturer.
        </Text>
      )}
      {siblings.length > 0 && (
        <Text size="sm" c="dimmed">
          Même payeur que{" "}
          {siblings.map((f, i) => (
            <span key={f.id}>
              {i > 0 && ", "}
              <Anchor component={Link} href={`/eleves/${f.id}`} inherit>
                {f.firstName}
              </Anchor>
            </span>
          ))}{" "}
          : réduction fratrie.
        </Text>
      )}

      {!open ? (
        <Button variant="default" className="self-start" data-changer onClick={() => setOpen(true)}>
          {current ? "Changer" : "Choisir"}
        </Button>
      ) : (
        <fieldset className="flex flex-col gap-2 border-t border-bordure pt-2">
          <legend className="sr-only">Facturer à</legend>
          {!minor && (
            <Radio
              name="facturer"
              label={firstName}
              checked={billedTo.type === "self"}
              disabled={inProgress}
              onChange={() => choose(() => invoice(studentId, { type: "self" }))}
            />
          )}
          {relatives.map((p) => (
            <Radio
              key={p.id}
              name="facturer"
              label={
                <>
                  {p.name}{" "}
                  <Text span size="xs" c="dimmed">
                    {p.relation === "legal_guardian" ? "responsable" : p.relation === "partner" ? "conjoint" : "proche"}
                  </Text>
                </>
              }
              checked={billedTo.type === "person" && billedTo.id === p.id}
              disabled={inProgress}
              onChange={() => choose(() => invoice(studentId, { type: "person", id: p.id }))}
            />
          ))}
          <Radio
            name="facturer"
            label="Un autre payeur : CSE, entreprise, proche…"
            checked={seeOther}
            onChange={() => setSeeOther(true)}
          />
          {seeOther && (
            <div className="flex flex-col gap-2 pl-7">
              <PersonChoice
                id="autre-payeur"
                label="Quel payeur ?"
                value={other}
                onChange={setOther}
                exclude={[studentId]}
                organization
              />
              <Button
                className="self-start"
                disabled={inProgress || !other}
                onClick={() => other && choose(() => billNewPerson(studentId, toInput(other)))}
              >
                Facturer à ce payeur
              </Button>
            </div>
          )}
          <Anchor component="button" type="button" size="xs" className="self-start" onClick={() => setOpen(false)}>
            Fermer
          </Anchor>
        </fieldset>
      )}
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </Paper>
  );
}
