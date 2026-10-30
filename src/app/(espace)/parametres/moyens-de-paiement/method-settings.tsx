"use client";

import { Button, Checkbox, Fieldset, Paper, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState, useTransition } from "react";
import { DESK_HINT_MAX, METHOD_LABELS, type Method, type MethodSetting } from "@/domain/payments/methods";
import { settle } from "@/lib/action-result";
import { savePaymentMethods } from "./actions";

/** What a method means for the desk, when its name alone does not say it. */
const DETAILS: Partial<Record<Method, string>> = {
  holiday_voucher: "Remis à l’accueil, puis déposés en banque avec un bordereau.",
  holiday_voucher_online:
    "Chèques vacances électroniques payés en ligne par l’ANCV : jamais dans une remise en banque.",
};

/** A setting as typed: the hint stays text, empty meaning none. */
type Row = { method: Method; accepted: boolean; hint: string };

/**
 * The payment methods the school accepts (#293), one line per method: ticked, it is
 * offered when collecting a payment, with an optional hint shown at the desk.
 */
export function MethodSettings({ settings }: { settings: MethodSetting[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    settings.map((s) => ({ method: s.method, accepted: s.accepted, hint: s.deskHint ?? "" })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const change = (method: Method, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.method === method ? { ...r, ...patch } : r)));

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          // A refusal or a lost connection keeps what was typed, with its message (#243).
          const r = await settle(() =>
            savePaymentMethods(
              rows.map((row) => ({ method: row.method, accepted: row.accepted, deskHint: row.hint.trim() || null })),
            ),
          );
          setMessage(r.ok ? null : r.message);
          if (r.ok) notifications.show({ color: "green", message: "Moyens de paiement enregistrés." });
        });
      }}
    >
      <Paper withBorder p="md">
        <Fieldset
          variant="unstyled"
          legend={<span className="font-semibold">Moyens acceptés</span>}
          aria-describedby="method-hint-help"
        >
          <Text id="method-hint-help" size="sm" c="dimmed">
            Une consigne, facultative, s’affiche sous le moyen choisi au moment d’encaisser.
          </Text>
          <div className="flex flex-col gap-4 pt-2">
            {rows.map((r) => (
              <div key={r.method} className="flex flex-col gap-2">
                <Checkbox
                  label={METHOD_LABELS[r.method]}
                  description={DETAILS[r.method]}
                  checked={r.accepted}
                  onChange={(e) => change(r.method, { accepted: e.currentTarget.checked })}
                />
                {r.accepted && (
                  <TextInput
                    className="pl-8"
                    label="Consigne pour l’accueil (facultatif)"
                    aria-label={`Consigne pour l’accueil, ${METHOD_LABELS[r.method]} (facultatif)`}
                    placeholder={r.method === "transfer" ? "Par exemple : règlement de la totalité" : undefined}
                    maxLength={DESK_HINT_MAX}
                    value={r.hint}
                    onChange={(e) => change(r.method, { hint: e.currentTarget.value })}
                  />
                )}
              </div>
            ))}
          </div>
        </Fieldset>
      </Paper>
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
