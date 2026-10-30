"use client";

import { Badge, Button, Group, Paper, Select, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useEffect, useRef, useState, useTransition } from "react";
import type { TreatmentInput, TreatmentRow } from "@/db/vat-treatments";
import { formatRate, typedRate, VAT_CATEGORIES, VAT_CATEGORY_LABELS, type VatCategory } from "@/domain/billing/vat";
import { type ActionResult, settle } from "@/lib/action-result";
import { isKeyOf } from "@/lib/has";
import { cancelOnEscape } from "../../_ui/escape-cancels";
import { useFocusAfter } from "../../_ui/use-focus-after";
import { changeTreatment, newTreatment, removeTreatment } from "./actions";

type Values = { label: string; category: VatCategory; rate: string; mention: string };

const EMPTY: Values = { label: "", category: "exempt", rate: "", mention: "" };

const valuesOf = (t: TreatmentRow): Values => ({
  label: t.label,
  category: t.category,
  rate: t.category === "standard" ? typedRate(t.rateBps) : "",
  mention: t.mention ?? "",
});

const CATEGORY_OPTIONS = VAT_CATEGORIES.map((value) => ({ value, label: VAT_CATEGORY_LABELS[value] }));

/** What a treatment does, in one line: « Taux de TVA 20 % », « Exonéré de TVA ». */
const summary = (t: TreatmentRow) =>
  t.category === "standard" ? `TVA ${formatRate(t.rateBps)}` : VAT_CATEGORY_LABELS[t.category];

function TreatmentForm({
  title,
  initial,
  submit,
  submitLabel,
  close,
  busy,
  message,
}: {
  title: string;
  initial: Values;
  submit: (v: TreatmentInput) => void;
  submitLabel: string;
  close: () => void;
  busy: boolean;
  /** The last refusal, in French: what was typed stays (#243). */
  message: string | null;
}) {
  const [v, setV] = useState(initial);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) alert.current?.focus();
  }, [message]);
  const withRate = v.category === "standard";
  return (
    <form
      aria-label={title}
      className="flex flex-col gap-3"
      // Escape first closes an open list (the category), then cancels.
      onKeyDown={cancelOnEscape(close)}
      onSubmit={(e) => {
        e.preventDefault();
        submit(v);
      }}
    >
      <Text size="sm" fw={600}>
        {title}
      </Text>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextInput
          id="treatment-label"
          label="Nom"
          description="Affiché dans la fiche des cours, par exemple « Exonéré » ou « TVA 20 % »."
          inputWrapperOrder={["label", "input", "description", "error"]}
          autoComplete="off"
          data-autofocus
          autoFocus
          value={v.label}
          onChange={(e) => setV({ ...v, label: e.currentTarget.value })}
        />
        <Select
          id="treatment-category"
          label="Type"
          allowDeselect={false}
          data={CATEGORY_OPTIONS}
          value={v.category}
          onChange={(x) => x !== null && isKeyOf(VAT_CATEGORY_LABELS, x) && setV({ ...v, category: x })}
        />
        {withRate ? (
          <TextInput
            id="treatment-rate"
            label="Taux de TVA"
            description="Les prix restent TTC : la TVA en est déduite."
            inputWrapperOrder={["label", "input", "description", "error"]}
            inputMode="decimal"
            autoComplete="off"
            placeholder="20"
            rightSection={
              <Text size="sm" c="dimmed" pr="xs">
                %
              </Text>
            }
            styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
            value={v.rate}
            onChange={(e) => setV({ ...v, rate: e.currentTarget.value })}
          />
        ) : (
          <Textarea
            id="treatment-mention"
            className="sm:col-span-2"
            label="Mention sur les lignes de facture"
            description="Obligatoire sans TVA : la base légale, à faire valider par le comptable."
            inputWrapperOrder={["label", "input", "description", "error"]}
            autosize
            minRows={1}
            value={v.mention}
            onChange={(e) => setV({ ...v, mention: e.currentTarget.value })}
          />
        )}
      </div>
      {message && (
        <Text role="alert" tabIndex={-1} size="sm" c="red" ref={alert}>
          {message}
        </Text>
      )}
      <Group gap="xs">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="subtle" color="gray" onClick={close}>
          Annuler
        </Button>
      </Group>
    </form>
  );
}

export function Treatments({ treatments }: { treatments: TreatmentRow[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The treatment whose removal is being confirmed.
  const [confirming, setConfirming] = useState<string | null>(null);
  const focusAfter = useFocusAfter();
  // A refusal or a lost connection keeps what was typed, with its message (#243).
  const act = (action: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const r = await settle(action);
      setMessage(r.ok ? null : r.message);
      if (r.ok) after?.();
    });
  const closeEdit = (id: string) => {
    focusAfter(`[data-edit="${id}"]`);
    setEditing(null);
    setMessage(null);
  };
  const closeAdd = () => {
    focusAfter("#add-treatment");
    setAdding(false);
    setMessage(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* A form shows its own refusal next to its buttons; this one is for a removal. */}
      {message && editing === null && !adding && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}

      {treatments.length === 0 && (
        <Text size="sm">Aucun traitement de TVA : ajoutez celui des cours, par exemple une exonération.</Text>
      )}

      {treatments.map((t) => (
        <Paper
          withBorder
          component="section"
          key={t.id}
          aria-labelledby={`treatment-${t.id}`}
          p="md"
          className="flex flex-col gap-2"
        >
          {editing === t.id ? (
            <TreatmentForm
              title={`Modifier ${t.label}`}
              initial={valuesOf(t)}
              submitLabel="Enregistrer"
              busy={busy}
              message={message}
              close={() => closeEdit(t.id)}
              submit={(v) =>
                act(
                  () => changeTreatment(t.id, v),
                  () => closeEdit(t.id),
                )
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Title order={2} size="h5" id={`treatment-${t.id}`} tabIndex={-1}>
                  {t.label}
                </Title>
                <Badge variant="light" color={t.category === "standard" ? "blue" : "gray"}>
                  {summary(t)}
                </Badge>
                <Group gap="xs" className="ml-auto">
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    aria-label={`Modifier le traitement ${t.label}`}
                    data-edit={t.id}
                    onClick={() => {
                      setAdding(false);
                      setMessage(null);
                      setEditing(t.id);
                    }}
                  >
                    Modifier
                  </Button>
                  {t.uses === 0 && t.defaultOf.length === 0 && confirming !== t.id && (
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      color="red"
                      disabled={busy}
                      aria-label={`Supprimer le traitement ${t.label}`}
                      onClick={() => {
                        setMessage(null);
                        setConfirming(t.id);
                        focusAfter(`[data-confirm="${t.id}"]`);
                      }}
                    >
                      Supprimer
                    </Button>
                  )}
                  {confirming === t.id && (
                    <>
                      <Text size="sm">Supprimer ce traitement ?</Text>
                      <Button
                        size="compact-sm"
                        color="red"
                        data-confirm={t.id}
                        loading={busy}
                        onClick={() =>
                          act(
                            () => removeTreatment(t.id),
                            () => {
                              setConfirming(null);
                              focusAfter("#add-treatment");
                            },
                          )
                        }
                      >
                        Oui, supprimer
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="gray"
                        onClick={() => {
                          setConfirming(null);
                          focusAfter(`[data-edit="${t.id}"]`);
                        }}
                      >
                        Non
                      </Button>
                    </>
                  )}
                </Group>
              </div>
              {t.mention && (
                <Text size="sm">
                  <Text span size="sm" c="dimmed">
                    Mention :{" "}
                  </Text>
                  {t.mention}
                </Text>
              )}
              <Text size="sm" c="dimmed">
                {[
                  t.defaultOf.length > 0 && `Par défaut pour ${t.defaultOf.join(", ")}.`,
                  t.uses === 0
                    ? t.defaultOf.length === 0 && "Utilisé nulle part."
                    : `Utilisé ${t.uses} fois (cours, carnets, factures).`,
                ]
                  .filter(Boolean)
                  .join(" ")}
              </Text>
            </>
          )}
        </Paper>
      ))}

      {adding ? (
        <Paper withBorder p="md">
          <TreatmentForm
            title="Nouveau traitement de TVA"
            initial={EMPTY}
            submitLabel="Ajouter le traitement"
            busy={busy}
            message={message}
            close={closeAdd}
            submit={(v) => act(() => newTreatment(v), closeAdd)}
          />
        </Paper>
      ) : (
        <div>
          <Button
            id="add-treatment"
            variant="default"
            onClick={() => {
              setEditing(null);
              setMessage(null);
              setAdding(true);
            }}
          >
            Ajouter un traitement de TVA
          </Button>
        </div>
      )}
    </div>
  );
}
