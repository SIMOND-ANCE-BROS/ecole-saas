"use client";

import { Badge, Button, Group, Modal, Paper, Select, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useEffect, useRef, useState, useTransition } from "react";
import type { EntityInput, EntityRow } from "@/db/billing-entities";
import type { TreatmentChoice } from "@/db/vat-treatments";
import { treatmentRefusal } from "@/domain/billing/vat";
import { VAT_REGIMES } from "@/db/instructors";
import { type ActionResult, settle } from "@/lib/action-result";
import { isKeyOf } from "@/lib/has";
import { compact } from "@/domain/billing/entity";
import { BusinessSearch } from "../../_ui/business-search";
import { useEscapeCancels } from "../../_ui/escape-asks";
import { useFocusAfter } from "../../_ui/use-focus-after";
import { changeEntity, defaultEntity, newEntity } from "../actions";

type Regime = keyof typeof VAT_REGIMES;
type Values = { [K in Exclude<keyof EntityInput, "vatRegime">]: string } & { vatRegime: Regime };

const EMPTY: Values = {
  name: "",
  legalName: "",
  siren: "",
  siret: "",
  vatNumber: "",
  addressLine: "",
  postalCode: "",
  city: "",
  vatRegime: "not_applicable",
  vatMention: "",
  bankAccountLabel: "",
  defaultVatTreatmentId: "",
};

const valuesOf = (e: EntityRow): Values => ({
  name: e.name,
  legalName: e.legalName,
  // Spaced as on the card and on paper; the spaces are removed again when saved.
  siren: e.siren ? spaced(e.siren) : "",
  siret: e.siret ? spaced(e.siret) : "",
  vatNumber: e.vatNumber ?? "",
  addressLine: e.addressLine ?? "",
  postalCode: e.postalCode ?? "",
  city: e.city ?? "",
  vatRegime: e.vatRegime,
  vatMention: e.vatMention ?? "",
  bankAccountLabel: e.bankAccountLabel ?? "",
  defaultVatTreatmentId: e.defaultVatTreatmentId ?? "",
});

/** « 000 000 001 », « 000 000 001 00012 »: easier to compare with a paper document. */
const spaced = (s: string) =>
  s.replace(/^(\d{3})(\d{3})(\d{3})(\d{5})?$/, (_, a, b, c, d) => [a, b, c, d].filter(Boolean).join(" "));

const REGIME_OPTIONS = Object.entries(VAT_REGIMES).map(([value, label]) => ({ value, label }));

/** The form of a new or edited entity; picking a company in the registry fills its identity. */
function EntityForm({
  title,
  initial,
  treatments,
  submit,
  submitLabel,
  close,
  busy,
  message,
}: {
  title: string;
  initial: Values;
  /** VAT treatments of the school (#301), for the default one. */
  treatments: TreatmentChoice[];
  submit: (v: Values) => void;
  submitLabel: string;
  close: () => void;
  busy: boolean;
  /** The last refusal, in French: what was typed stays (#243). */
  message: string | null;
}) {
  const [v, setV] = useState(initial);
  const form = useRef<HTMLFormElement>(null);
  const escape = useEscapeCancels(form, close);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) alert.current?.focus();
  }, [message]);
  const set = (field: keyof Values) => (e: { currentTarget: { value: string } }) =>
    setV({ ...v, [field]: e.currentTarget.value });
  const field = (name: keyof Values, label: string, extra: { inputMode?: "numeric"; placeholder?: string } = {}) => (
    <TextInput id={`entity-${name}`} label={label} autoComplete="off" value={v[name]} onChange={set(name)} {...extra} />
  );
  return (
    <form
      ref={form}
      aria-label={title}
      className="flex flex-col gap-3"
      // Escape first closes an open list (the VAT regime, the registry results), then cancels,
      // asking first if anything was typed or chosen (#339).
      onKeyDown={escape.onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        submit(v);
      }}
    >
      <Text size="sm" fw={600}>
        {title}
      </Text>
      <BusinessSearch
        // The button that opened the form is gone: focus starts in the form, as on the other settings screens.
        autoFocus
        filled={(b) =>
          b.street ? "raison sociale, SIREN, SIRET et adresse remplis." : "raison sociale et SIREN remplis."
        }
        description="Nom, SIREN ou SIRET : choisir une entreprise remplit la raison sociale, le SIREN, le SIRET du siège et l’adresse."
        onPick={(b) =>
          setV((now) => ({
            ...now,
            name: now.name || b.legalName,
            legalName: b.legalName,
            siren: b.siren,
            siret: b.siret ?? (b.siren === compact(now.siren) ? now.siret : ""),
            // Without a public street (sole trader), the address typed is kept.
            addressLine: b.street ?? now.addressLine,
            postalCode: b.street ? (b.postcode ?? "") : now.postalCode,
            city: b.street ? (b.city ?? "") : now.city,
          }))
        }
      />
      <div className="grid items-start gap-3 sm:grid-cols-2">
        {field("name", "Nom court (affiché dans les listes)")}
        {field("legalName", "Raison sociale")}
        {field("siren", "SIREN", { inputMode: "numeric", placeholder: "9 chiffres" })}
        {field("siret", "SIRET", { inputMode: "numeric", placeholder: "14 chiffres" })}
        <div className="sm:col-span-2">{field("addressLine", "Adresse")}</div>
        {field("postalCode", "Code postal", { inputMode: "numeric" })}
        {field("city", "Ville")}
        <Select
          id="entity-vatRegime"
          label="Régime de TVA"
          allowDeselect={false}
          data={REGIME_OPTIONS}
          value={v.vatRegime}
          onChange={(x) => x !== null && isKeyOf(VAT_REGIMES, x) && setV({ ...v, vatRegime: x })}
        />
        {field("vatNumber", "N° de TVA intracommunautaire (facultatif)")}
        <Select
          id="entity-defaultVatTreatmentId"
          className="sm:col-span-2"
          label="Traitement de TVA par défaut"
          description={
            treatments.length === 0
              ? "Aucun traitement de TVA : ajoutez-en dans Paramètres › TVA."
              : treatmentRefusal(v.vatRegime, "standard")
                ? "Appliqué aux carnets vendus par cette entreprise et proposé pour ses nouveaux cours. Sans TVA, les traitements avec un taux ne sont pas proposés."
                : "Appliqué aux carnets vendus par cette entreprise et proposé pour ses nouveaux cours."
          }
          inputWrapperOrder={["label", "input", "description", "error"]}
          placeholder="À choisir"
          allowDeselect={false}
          // A business without VAT is offered no treatment with a rate (#301).
          data={treatments
            .filter((t) => t.id === v.defaultVatTreatmentId || treatmentRefusal(v.vatRegime, t.category) === null)
            .map((t) => ({ value: t.id, label: t.label }))}
          value={v.defaultVatTreatmentId || null}
          onChange={(x) => setV({ ...v, defaultVatTreatmentId: x ?? "" })}
        />
        <Textarea
          id="entity-vatMention"
          className="sm:col-span-2"
          label="Mention de TVA sur les factures (facultative)"
          description="Imprimée une fois sur chaque facture de cette entreprise. À faire valider par le comptable."
          inputWrapperOrder={["label", "input", "description", "error"]}
          autosize
          minRows={1}
          value={v.vatMention}
          onChange={set("vatMention")}
        />
        <TextInput
          id="entity-bankAccountLabel"
          className="sm:col-span-2"
          label="Compte bancaire (facultatif)"
          description="Le nom du compte, qui sera imprimé sur les bordereaux de remise en banque. Jamais l’IBAN."
          inputWrapperOrder={["label", "input", "description", "error"]}
          autoComplete="off"
          value={v.bankAccountLabel}
          onChange={set("bankAccountLabel")}
        />
      </div>
      {message && (
        // Next to « Enregistrer », where the eyes are; focused so a screen reader reads it.
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
      {escape.confirm}
    </form>
  );
}

/** One entity, as read: identity, VAT and bank account. */
function Summary({ e, treatments }: { e: EntityRow; treatments: TreatmentChoice[] }) {
  const address = [e.addressLine, [e.postalCode, e.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const rows: [string, string | null][] = [
    ["Raison sociale", e.legalName],
    ["SIREN", e.siren && spaced(e.siren)],
    ["SIRET", e.siret && spaced(e.siret)],
    ["Adresse", address || null],
    ["TVA", VAT_REGIMES[e.vatRegime] + (e.vatNumber ? ` · ${e.vatNumber}` : "")],
    ["Mention sur les factures", e.vatMention],
    ["Traitement de TVA par défaut", treatments.find((t) => t.id === e.defaultVatTreatmentId)?.label ?? null],
    ["Compte bancaire", e.bankAccountLabel],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <Text component="dt" size="sm" c="dimmed">
            {label}
          </Text>
          <Text component="dd" size="sm" c={value ? undefined : "dimmed"}>
            {value ?? "—"}
          </Text>
        </div>
      ))}
    </dl>
  );
}

export function Entities({ entities, treatments }: { entities: EntityRow[]; treatments: TreatmentChoice[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState<EntityRow | null>(null);
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
    focusAfter("#add-entity");
    setAdding(false);
    setMessage(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <Modal
        opened={asking !== null}
        onClose={() => setAsking(null)}
        title={asking ? `Choisir ${asking.name} par défaut ?` : ""}
        centered
      >
        <Text size="sm">
          Les prochains paiements saisis à l’accueil seront encaissés par cette entreprise. Les paiements déjà
          enregistrés ne changent pas.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setAsking(null)} data-autofocus>
            Annuler
          </Button>
          <Button
            onClick={() => {
              const e = asking;
              setAsking(null);
              if (e)
                act(
                  () => defaultEntity(e.id),
                  () => focusAfter(`#entity-${e.id}`),
                );
            }}
          >
            Choisir par défaut
          </Button>
        </Group>
      </Modal>

      {/* A form shows its own refusal next to its buttons; this one is for the change of default. */}
      {message && editing === null && !adding && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}

      {entities.length === 0 && (
        <Text size="sm">
          Aucune entreprise : ajoutez celle qui encaisse les paiements, elle sera l’entreprise par défaut.
        </Text>
      )}

      {entities.map((e) => (
        <Paper
          withBorder
          component="section"
          key={e.id}
          aria-labelledby={`entity-${e.id}`}
          p="md"
          className="flex flex-col gap-3"
        >
          {editing === e.id ? (
            <EntityForm
              title={`Modifier ${e.name}`}
              initial={valuesOf(e)}
              treatments={treatments}
              submitLabel="Enregistrer"
              busy={busy}
              message={message}
              close={() => closeEdit(e.id)}
              submit={(v) =>
                act(
                  () => changeEntity(e.id, v),
                  () => closeEdit(e.id),
                )
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Title order={2} size="h5" id={`entity-${e.id}`} tabIndex={-1}>
                  {e.name}
                </Title>
                {e.isDefault && <Badge variant="light">par défaut</Badge>}
                <Group gap="xs" className="ml-auto">
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    aria-label={`Modifier l’entreprise ${e.name}`}
                    data-edit={e.id}
                    onClick={() => {
                      setAdding(false);
                      setMessage(null);
                      setEditing(e.id);
                    }}
                  >
                    Modifier
                  </Button>
                  {!e.isDefault && (
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      disabled={busy}
                      aria-label={`Choisir ${e.name} par défaut`}
                      onClick={() => setAsking(e)}
                    >
                      Choisir par défaut
                    </Button>
                  )}
                </Group>
              </div>
              <Summary e={e} treatments={treatments} />
            </>
          )}
        </Paper>
      ))}

      {adding ? (
        <Paper withBorder p="md">
          <EntityForm
            title="Nouvelle entreprise"
            initial={EMPTY}
            treatments={treatments}
            submitLabel="Ajouter l’entreprise"
            busy={busy}
            message={message}
            close={closeAdd}
            submit={(v) => act(() => newEntity(v), closeAdd)}
          />
        </Paper>
      ) : (
        <div>
          <Button
            id="add-entity"
            variant="default"
            onClick={() => {
              setEditing(null);
              setMessage(null);
              setAdding(true);
            }}
          >
            Ajouter une entreprise
          </Button>
        </div>
      )}
    </div>
  );
}
