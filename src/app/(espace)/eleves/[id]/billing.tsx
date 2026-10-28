"use client";

import { Anchor, Button, Loader, Paper, Radio, Text, Title } from "@mantine/core";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { StudentRecord, StudentRelative } from "@/db/students";
import { has } from "@/lib/has";
import { type Choice, PersonChoice, toInput } from "../../_people/person-choice";
import { WARNING } from "../../_people/sections";
import type { ActionResult } from "@/lib/action-result";
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

/** The payer shown in the card: `key` matches the choices (`self`, `p:<id>`). */
type Payer = { key: string; name: string; href: string | null };

const FAILED = "Payeur non enregistré : réessayez. Si le problème continue, vérifiez la connexion.";

/** Name of a payer picked or typed in the person search. */
const choiceName = (c: Choice) =>
  has(c, "id")
    ? c.name
    : c.newPerson.type === "organisation"
      ? c.newPerson.companyName
      : `${c.newPerson.firstName} ${c.newPerson.name}`.trim();

/**
 * « Facturé à »: a single payer. A mouse click on a choice bills it at once;
 * with the keyboard the arrow keys only move the selection, and Enter or the
 * « Facturer à … » button bills it (#221). Escape closes the choices.
 */
export function Billing({
  studentId: studentId,
  firstName: firstName,
  minor: minor,
  billedTo,
  relatives: relatives,
  siblings: siblings,
}: Props) {
  const fromServer: Payer | null =
    billedTo.type === "self"
      ? { key: "self", name: `${firstName} (paie ses cours)`, href: null }
      : billedTo.type === "person"
        ? { key: `p:${billedTo.id}`, name: billedTo.name, href: `/personnes/${billedTo.id}` }
        : null;
  // The payer just saved, shown at once; it gives way as soon as the refreshed record says otherwise.
  const [saved, setSaved] = useState<{ over: string | null; payer: Payer } | null>(null);
  const payer = saved && saved.over === (fromServer?.key ?? null) ? saved.payer : fromServer;
  const currentKey = payer?.key ?? null;

  const [open, setOpen] = useState(false);
  // The choice selected in the group, billed only on an explicit action.
  const [selected, setSelected] = useState<string | null>(currentKey);
  const [other, setOther] = useState<Choice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState("");
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

  const choose = (target: Payer, action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      let failure: string | null;
      try {
        const r = await action();
        failure = r.ok ? null : r.message;
      } catch (e) {
        // A lost connection or a server error keeps the record on screen, with a way out.
        unstable_rethrow(e);
        failure = FAILED;
      }
      setMessage(failure);
      if (failure) {
        // Back to what can be retried: the « Facturer à … » button, else the selected choice.
        requestAnimationFrame(() =>
          (
            box.current?.querySelector<HTMLElement>("[data-bill]") ??
            box.current?.querySelector<HTMLElement>("input[type='radio']:checked")
          )?.focus(),
        );
        return;
      }
      setSaved({ over: fromServer?.key ?? null, payer: target });
      setDone(`Payeur changé : ${target.name}.`);
      setOpen(false);
      setOther(null);
    });

  const hrefOf = (key: string) => (key.startsWith("p:") ? `/personnes/${key.slice(2)}` : null);
  const select = (key: string) => {
    if (inProgress) return;
    setSelected(key);
    const option = options.find((o) => o.key === key);
    // A click bills at once; an arrow key only moves the selection.
    if (pointer.current && option && key !== currentKey) {
      choose({ key: option.key, name: option.name, href: hrefOf(option.key) }, option.bill);
    }
  };
  const billChosen = () =>
    chosen && !inProgress && choose({ key: chosen.key, name: chosen.name, href: hrefOf(chosen.key) }, chosen.bill);
  const billOther = () => {
    if (!other || inProgress) return;
    const target: Payer = has(other, "id")
      ? { key: `p:${other.id}`, name: other.name, href: `/personnes/${other.id}` }
      : { key: "new", name: choiceName(other), href: null };
    choose(target, () => billNewPerson(studentId, toInput(other)));
  };

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
      {payer ? (
        <Text fw={500}>
          {payer.href ? (
            <Anchor component={Link} href={payer.href} inherit>
              {payer.name}
            </Anchor>
          ) : (
            payer.name
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
            pointer.current = false;
            setSelected(currentKey);
            setMessage(null);
            setDone("");
            setOpen(true);
          }}
        >
          {payer ? "Changer" : "Choisir"}
        </Button>
      ) : (
        <form
          onSubmit={(e) => {
            // Enter on a choice bills the selected payer.
            e.preventDefault();
            billChosen();
          }}
        >
          <fieldset
            data-choices
            tabIndex={-1}
            className="flex flex-col gap-2 border-t border-bordure pt-2 outline-offset-2"
            onPointerDownCapture={() => (pointer.current = true)}
            onKeyDownCapture={() => (pointer.current = false)}
            onKeyDown={(e) => {
              // Like « Annuler »: back to « Changer », nothing billed.
              if (e.key === "Escape" && !e.defaultPrevented && !inProgress) {
                e.preventDefault();
                setOpen(false);
              }
            }}
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
                  onChange={() => select(o.key)}
                />
              );
            })}
            <Radio
              name="facturer"
              label="Un autre payeur : CSE, entreprise, proche…"
              checked={selected === "other"}
              onChange={() => !inProgress && setSelected("other")}
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
                  variant="light"
                  className="self-start"
                  data-bill={other ? "" : undefined}
                  disabled={!other}
                  aria-disabled={inProgress || undefined}
                  rightSection={inProgress ? <Loader size="xs" /> : null}
                  onClick={billOther}
                >
                  Facturer à ce payeur
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {chosen && (
                // Stays focusable while saving (aria-disabled, not disabled): focus never falls to the page.
                <Button
                  type="submit"
                  variant="light"
                  data-bill
                  aria-disabled={inProgress || undefined}
                  rightSection={inProgress ? <Loader size="xs" /> : null}
                >
                  Facturer à {chosen.name}
                </Button>
              )}
              <Anchor component="button" type="button" size="xs" onClick={() => !inProgress && setOpen(false)}>
                Fermer
              </Anchor>
            </div>
          </fieldset>
        </form>
      )}
      {/* Always present, so screen readers announce the text when it appears. */}
      <Text role="status" size="sm" className={done ? undefined : "sr-only"}>
        {done}
      </Text>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </Paper>
  );
}
