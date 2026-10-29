"use client";

import { Button, Checkbox, Fieldset, NumberInput, Paper, Radio, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState, useTransition } from "react";
import { DOCUMENT_LABELS, DUE_WITHIN_DAYS_MAX, type Requirement, VALIDITY_MONTHS_MAX } from "@/domain/people/documents";
import { settle } from "@/lib/action-result";
import { saveDocumentRequirements } from "./actions";

/** A requirement as typed: numbers stay text until saved, so an empty validity means « sans limite ». */
type Row = Omit<Requirement, "validityMonths" | "dueWithinDays"> & { validity: string; due: string };

const toRow = (r: Requirement): Row => ({
  type: r.type,
  required: r.required,
  minorsOnly: r.minorsOnly,
  validity: r.validityMonths === null ? "" : String(r.validityMonths),
  due: String(r.dueWithinDays),
});

/**
 * The documents the school asks for (#287), one block per document: asked
 * or not, of every student or of minors only, and how long it stays valid.
 */
export function Requirements({ requirements }: { requirements: Requirement[] }) {
  const [rows, setRows] = useState(() => requirements.map(toRow));
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const change = (type: Row["type"], patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.type === type ? { ...r, ...patch } : r)));

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          // A refusal or a lost connection keeps what was typed, with its message (#243).
          const r = await settle(() =>
            saveDocumentRequirements(
              rows.map(({ validity, due, ...row }) => ({
                ...row,
                validityMonths: validity.trim() === "" ? null : Number(validity),
                // Empty: refused by the server with its French message, never taken as 0.
                dueWithinDays: due.trim() === "" ? Number.NaN : Number(due),
              })),
            ),
          );
          setMessage(r.ok ? null : r.message);
          if (r.ok) notifications.show({ color: "green", message: "Documents demandés enregistrés." });
        });
      }}
    >
      {rows.map((r) => {
        const label = DOCUMENT_LABELS[r.type];
        return (
          <Paper key={r.type} withBorder p="md">
            <Fieldset variant="unstyled" legend={<span className="font-semibold">{label}</span>}>
              <div className="flex flex-col gap-3 pt-2">
                <Checkbox
                  label="Demander ce document"
                  checked={r.required}
                  onChange={(e) => change(r.type, { required: e.currentTarget.checked })}
                />
                <Radio.Group
                  label="À qui"
                  value={r.minorsOnly ? "minors" : "all"}
                  onChange={(v) => change(r.type, { minorsOnly: v === "minors" })}
                >
                  <Group gap="lg" mt={4}>
                    <Radio value="all" label="Tous les élèves" disabled={!r.required} />
                    <Radio value="minors" label="Les élèves mineurs" disabled={!r.required} />
                  </Group>
                </Radio.Group>
                <NumberInput
                  label="Valable (mois)"
                  disabled={!r.required}
                  description="À partir de la date du document. Vide : sans limite."
                  min={1}
                  max={VALIDITY_MONTHS_MAX}
                  allowDecimal={false}
                  allowNegative={false}
                  // No silent correction on blur: the server says what is wrong.
                  clampBehavior="none"
                  classNames={{ input: "w-48" }}
                  value={r.validity}
                  onChange={(v) => change(r.type, { validity: String(v) })}
                />
                <NumberInput
                  label="Délai pour le fournir (jours)"
                  disabled={!r.required}
                  description="Délai après l’inscription ; passé ce délai, le document est en retard."
                  min={0}
                  max={DUE_WITHIN_DAYS_MAX}
                  allowDecimal={false}
                  allowNegative={false}
                  clampBehavior="none"
                  classNames={{ input: "w-48" }}
                  value={r.due}
                  onChange={(v) => change(r.type, { due: String(v) })}
                />
              </div>
            </Fieldset>
          </Paper>
        );
      })}
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      <div>
        <Button type="submit" loading={inProgress}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
