"use client";

import { Anchor, Button, Paper, Radio, Text, Title } from "@mantine/core";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { StudentRecord, StudentRelative } from "@/db/students";
import { has } from "@/lib/has";
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

/** Name of a payer picked or typed in the person search, for the confirmation. */
const choiceName = (c: Choice) =>
  has(c, "id")
    ? c.name
    : c.newPerson.type === "organisation"
      ? c.newPerson.companyName
      : `${c.newPerson.firstName} ${c.newPerson.name}`.trim();

/**
 * « Facturé à »: a single payer. A mouse click on a choice bills it at once;
 * with the keyboard the arrow keys only move the selection, and Enter or the
 * « Facturer à … » button bills it (#221).
 */
export function Billing({
  studentId: studentId,
  firstName: firstName,
  minor: minor,
  billedTo,
  relatives: relatives,
  siblings: siblings,
}: Props) {
  const currentKey = billedTo.type === "self" ? "self" : billedTo.type === "person" ? `p:${billedTo.id}` : null;
  const [open, setOpen] = useState(false);
  // The choice selected in the group, billed only on an explicit action.
  const [selected, setSelected] = useState<string | null>(currentKey);
  const [other, setOther] = useState<Choice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const box = useRef<HTMLElement>(null);
  // Whether the last gesture in the choices was a pointer (click, tap) rather than a key.
  const pointer = useRef(false);
  // Opening and closing swap « Changer » and the choices: focus follows, never back to the page.
  const opened = useRef(open);
  useEffect(() => {
    if (opened.current === open) return;
    opened.current = open;
    box.current?.querySelector<HTMLElement>(open ? "[data-choices]" : "[data-change]")?.focus();
  }, [open]);

  const options = [
    ...(minor ? [] : [{ key: "self", name: firstName, bill: () => invoice(studentId, { type: "self" }) }]),
    ...relatives.map((p) => ({
      key: `p:${p.id}`,
      name: p.name,
      bill: () => invoice(studentId, { type: "person", id: p.id }),
    })),
  ];
  const chosen = options.find((o) => o.key === selected && o.key !== currentKey);

  const choose = (name: string, action: () => Promise<{ message: string | null }>) =>
    startTransition(async () => {
      let r: { message: string | null };
      try {
        r = await action();
      } catch (e) {
        // A lost connection keeps the record on screen, with a way out.
        unstable_rethrow(e);
        setMessage("Payeur non enregistré : vérifiez la connexion et réessayez.");
        return;
      }
      setMessage(r.message);
      if (!r.message) {
        setDone(`Facturé à ${name}.`);
        setOpen(false);
        setOther(null);
      }
    });

  const select = (key: string) => {
    setSelected(key);
    const option = options.find((o) => o.key === key);
    // A click bills at once; an arrow key only moves the selection.
    if (pointer.current && option && key !== currentKey) choose(option.name, option.bill);
  };

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
        <Button
          variant="default"
          className="self-start"
          data-change
          onClick={() => {
            setSelected(currentKey);
            setMessage(null);
            setDone(null);
            setOpen(true);
          }}
        >
          {current ? "Changer" : "Choisir"}
        </Button>
      ) : (
        <form
          onSubmit={(e) => {
            // Enter on a choice bills the selected payer.
            e.preventDefault();
            if (chosen && !inProgress) choose(chosen.name, chosen.bill);
          }}
        >
          <fieldset
            data-choices
            tabIndex={-1}
            className="flex flex-col gap-2 border-t border-bordure pt-2 outline-offset-2"
            onPointerDownCapture={() => (pointer.current = true)}
            onKeyDownCapture={() => (pointer.current = false)}
          >
            <legend className="sr-only">Facturer à</legend>
            {options.map((o) => {
              const p = relatives.find((r) => `p:${r.id}` === o.key);
              return (
                <Radio
                  key={o.key}
                  name="facturer"
                  label={
                    p ? (
                      <>
                        {p.name}{" "}
                        <Text span size="xs" c="dimmed">
                          {p.relation === "legal_guardian"
                            ? "responsable"
                            : p.relation === "partner"
                              ? "conjoint"
                              : "proche"}
                        </Text>
                      </>
                    ) : (
                      o.name
                    )
                  }
                  checked={selected === o.key}
                  disabled={inProgress}
                  onChange={() => select(o.key)}
                />
              );
            })}
            <Radio
              name="facturer"
              label="Un autre payeur : CSE, entreprise, proche…"
              checked={selected === "other"}
              disabled={inProgress}
              onChange={() => setSelected("other")}
            />
            {selected === "other" && (
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
                  onClick={() => other && choose(choiceName(other), () => billNewPerson(studentId, toInput(other)))}
                >
                  Facturer à ce payeur
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {chosen && (
                <Button type="submit" loading={inProgress}>
                  Facturer à {chosen.name}
                </Button>
              )}
              <Anchor component="button" type="button" size="xs" onClick={() => setOpen(false)}>
                Fermer
              </Anchor>
            </div>
          </fieldset>
        </form>
      )}
      {done && (
        <Text role="status" size="sm">
          {done}
        </Text>
      )}
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </Paper>
  );
}
