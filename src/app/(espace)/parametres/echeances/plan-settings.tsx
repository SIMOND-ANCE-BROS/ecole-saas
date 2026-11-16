"use client";

import { Button, Checkbox, NumberInput, Paper, Radio, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState, useTransition } from "react";
import { computeSchedule } from "@/domain/invoicing/installments";
import {
  type InstallmentPlanSetting,
  MAX_DUE_DAY,
  MAX_INSTALLMENTS,
  planLabel,
  planSettingRefusal,
  sortedCounts,
} from "@/domain/invoicing/plans";
import { settle } from "@/lib/action-result";
import { formatEuros } from "@/lib/money";
import { FormPage } from "../../_ui/form-page";
import { saveInstallmentPlanSetting } from "./actions";

const COUNTS = Array.from({ length: MAX_INSTALLMENTS }, (_, i) => i + 1);
/** The example the screen splits: a yearly package of 415,00 €. */
const EXAMPLE_CENTS = 41500;

/** « 3 fois : 139,00 € + 138,00 € + 138,00 € »: what a plan makes of the example. */
function example(count: number, roundingUnitCents: number): string {
  try {
    const amounts = computeSchedule({
      amountCents: EXAMPLE_CENTS,
      installmentCount: count,
      firstDate: "2000-01-01",
      roundingUnitCents,
    }).map((i) => i.amountCents);
    const rest = amounts.slice(1);
    const label = planLabel(count).replace(/^en/, "En");
    if (count === 1) return `${label} : ${formatEuros(amounts[0])}`;
    return count > 2 && rest.every((a) => a === rest[0])
      ? `${label} : ${formatEuros(amounts[0])} puis ${count - 1} × ${formatEuros(rest[0])}`
      : `${label} : ${amounts.map(formatEuros).join(" + ")}`;
  } catch {
    return `${planLabel(count).replace(/^en/, "En")} : impossible`;
  }
}

/**
 * The school's installment plans (#176): the counts offered, the day of the month and the
 * rounding, with what each plan makes of a 415,00 € package.
 */
export function PlanSettings({ setting }: { setting: InstallmentPlanSetting }) {
  const [counts, setCounts] = useState<number[]>([...setting.counts]);
  const [dueDay, setDueDay] = useState<number | string>(setting.dueDay);
  const [rounding, setRounding] = useState(String(setting.roundingUnitCents));
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  // Bumped after a save: the unsaved-input guard starts again from what was saved.
  const [saves, setSaves] = useState(0);
  const entry = { counts: sortedCounts(counts), dueDay: Number(dueDay), roundingUnitCents: Number(rounding) };

  return (
    <FormPage key={saves}>
      <form
        className="flex max-w-2xl flex-col gap-4"
        // A change clears the last refusal: it may no longer hold.
        onChange={() => setMessage(null)}
        onSubmit={(e) => {
          e.preventDefault();
          const refusal = planSettingRefusal(entry);
          if (refusal) {
            setMessage(refusal);
            return;
          }
          startTransition(async () => {
            // A refusal or a lost connection keeps what was typed, with its message (#243).
            const r = await settle(() => saveInstallmentPlanSetting(entry));
            setMessage(r.ok ? null : r.message);
            if (r.ok) {
              notifications.show({ color: "green", message: "Paiement en plusieurs fois enregistré." });
              setSaves((n) => n + 1);
            }
          });
        }}
      >
        <Paper withBorder p="md" className="flex flex-col gap-4">
          <Checkbox.Group
            label="Nombre d’échéances proposées"
            description="Chaque choix coché devient un bouton « En … fois » sur la fiche du payeur. Un plan dont la dernière échéance tomberait après la fin de la saison n’est pas proposé."
            value={counts.map(String)}
            onChange={(v) => setCounts(v.map(Number))}
            error={entry.counts.length === 0 ? "Proposez au moins un plan de paiement." : undefined}
          >
            <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
              {COUNTS.map((c) => (
                <Checkbox key={c} value={String(c)} label={planLabel(c).replace(/^en/, "En")} />
              ))}
            </div>
          </Checkbox.Group>
          <NumberInput
            label="Jour d’échéance dans le mois"
            description={`Du 1er au ${MAX_DUE_DAY} : chaque échéance tombe ce jour-là, chaque mois. Préparée avant la rentrée, une facture a sa première échéance ce jour-là du premier mois de la saison, ou du mois suivant si ce jour est passé.`}
            min={1}
            max={MAX_DUE_DAY}
            allowDecimal={false}
            allowNegative={false}
            clampBehavior="strict"
            value={dueDay}
            onChange={setDueDay}
            classNames={{ wrapper: "max-w-60" }}
          />
          <Radio.Group
            label="Arrondi des échéances"
            description="Le reste, centimes compris, va sur la première échéance."
            value={rounding}
            onChange={setRounding}
          >
            <div className="flex flex-col gap-2 pt-2">
              <Radio value="100" label="À l’euro" />
              <Radio value="1" label="Au centime" />
            </div>
          </Radio.Group>
        </Paper>
        {entry.counts.length > 0 && (
          <Paper withBorder p="md" className="flex flex-col gap-1">
            <Text size="sm" fw={600}>
              Exemple : un forfait de {formatEuros(EXAMPLE_CENTS)}
            </Text>
            <ul className="flex flex-col text-sm tabular-nums">
              {entry.counts.map((c) => (
                <li key={c}>{example(c, entry.roundingUnitCents)}</li>
              ))}
            </ul>
          </Paper>
        )}
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
    </FormPage>
  );
}
