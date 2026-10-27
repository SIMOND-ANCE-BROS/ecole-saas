"use client";

import {
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState, useTransition } from "react";
import type { Siblings as SiblingsRule, LessonPackRow, GridRow, Period, Audience } from "@/db/tariffs";
import { combinationLabel } from "@/domain/tariff/compute";
import { formatEuros, parseEuros } from "@/lib/money";
import { lessonPack, cellPrice, siblingsRule, removeLessonPack } from "../actions";

const AUDIENCES: [Audience, string][] = [
  ["child", "Enfant"],
  ["adult", "Adulte"],
  ["couple", "Couple"],
  ["student", "Étudiant"],
];
const PERIODS: [Period, string][] = [
  ["quarter", "Trimestre"],
  ["year", "Année"],
  ["single", "À l’unité"],
];
const DURATIONS = [30, 45, 60, 75, 90, 120];
/** Amounts are read right-aligned, in tabular figures (DESIGN.md). */
const AMOUNT = { input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } } as const;

/** Cents → euro input (« 110 », « 112,50 »), without floating-point numbers. */
const inEuros = (c: number) => `${Math.trunc(c / 100)}${c % 100 ? `,${String(c % 100).padStart(2, "0")}` : ""}`;

type State = "saved" | "error" | null;

/** Price of a cell, saved when leaving the field (Enter or Tab); empty = no package. */
function PriceCell({
  seasonId: seasonId,
  row: row,
  period: period,
  label: label,
}: {
  seasonId: string;
  row: Pick<GridRow, "audience" | "combination" | "disciplineId" | "price">;
  period: Period;
  label: string;
}) {
  const current = row.price[period];
  const initial = current ? inEuros(current.cents) : "";
  const [value, setValue] = useState(initial);
  // The saved price comes back with the refresh (« 112,5 » → « 112,50 »): follow it, keep ✓.
  const [shown, setShown] = useState(initial);
  if (shown !== initial) {
    setShown(initial);
    setValue(initial);
  }
  const [state, setState] = useState<State>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();

  const save = () => {
    if (value.trim() === initial) return;
    const cents = value.trim() === "" ? null : parseEuros(value);
    if (value.trim() !== "" && cents === null) {
      setState("error");
      setMessage("Montant en euros, par exemple 110 ou 112,50");
      return;
    }
    startTransition(async () => {
      const r = await cellPrice(seasonId, {
        audience: row.audience,
        combination: row.combination,
        disciplineId: row.disciplineId,
        period: period,
        priceCents: cents,
      });
      setState(r.message ? "error" : "saved");
      setMessage(r.message);
      if (r.message) setValue(initial);
    });
  };

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1">
        <TextInput
          aria-label={label}
          inputMode="decimal"
          size="xs"
          w={96}
          styles={AMOUNT}
          error={state === "error"}
          value={value}
          placeholder="—"
          disabled={inProgress}
          onChange={(e) => {
            setValue(e.currentTarget.value);
            setState(null);
          }}
          onBlur={save}
          data-price-cell={period}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // Like a spreadsheet: Enter saves (on leaving the field) and goes down to the same column.
            e.preventDefault();
            const column = [...document.querySelectorAll<HTMLInputElement>(`input[data-price-cell="${period}"]`)];
            const below = column[column.indexOf(e.currentTarget) + 1];
            if (below) below.focus();
            else e.currentTarget.blur();
          }}
        />
        <span className="w-3 text-xs" aria-hidden>
          {state === "saved" ? "✓" : "€"}
        </span>
        <span role="status" className="sr-only">
          {state === "saved" ? "Enregistré" : ""}
        </span>
      </div>
      {current?.used && (
        <Text span size="xs" c="dimmed">
          déjà utilisé
        </Text>
      )}
      {message && (
        <Text span role="alert" size="xs" c="red" maw={160} ta="right">
          {message}
        </Text>
      )}
    </div>
  );
}

export function Grid({
  seasonId: seasonId,
  grid: grid,
  disciplines,
}: {
  seasonId: string;
  grid: GridRow[];
  disciplines: { id: string; name: string }[];
}) {
  const [chosenAudience, setAudience] = useState<Audience>("child");
  const [combination, setCombination] = useState<number[]>([]);
  const [disciplineId, setDisciplineId] = useState("");
  const [duration, setDuration] = useState("60");
  const [newPrices, setNewPrice] = useState<Record<Period, string>>({
    quarter: "",
    year: "",
    single: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const rows = grid.filter((l) => l.audience === chosenAudience);

  const addRow = () =>
    startTransition(async () => {
      const price = PERIODS.flatMap(([p]) => (newPrices[p].trim() ? [[p, parseEuros(newPrices[p])] as const] : []));
      if (price.length === 0) return setMessage("Indiquez au moins un prix.");
      if (price.some(([, c]) => c === null)) return setMessage("Montant en euros, par exemple 110 ou 112,50.");
      for (const [period, cents] of price) {
        const r = await cellPrice(seasonId, {
          audience: chosenAudience,
          combination: combination,
          disciplineId: disciplineId || null,
          period: period,
          priceCents: cents,
        });
        if (r.message) return setMessage(r.message);
      }
      setMessage(null);
      setCombination([]);
      setNewPrice({ quarter: "", year: "", single: "" });
    });

  const removeRow = (l: GridRow) =>
    startTransition(async () => {
      for (const [period] of PERIODS) {
        if (!l.price[period]) continue;
        const r = await cellPrice(seasonId, {
          audience: l.audience,
          combination: l.combination,
          disciplineId: l.disciplineId,
          period: period,
          priceCents: null,
        });
        if (r.message) return setMessage(r.message);
      }
      setMessage(null);
    });

  return (
    <section aria-labelledby="grille" className="flex flex-col gap-3">
      <Title order={2} size="h5" id="grille">
        Grille des forfaits
      </Title>
      <SegmentedControl
        aria-label="Public"
        className="self-start"
        value={chosenAudience}
        onChange={(p) => setAudience(p as Audience)}
        data={AUDIENCES.map(([p, label]) => ({
          value: p,
          label: `${label} (${grid.filter((l) => l.audience === p).length})`,
        }))}
      />

      <Paper withBorder className="relative overflow-x-auto">
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Cours de la semaine</Table.Th>
              {PERIODS.map(([p, label]) => (
                <Table.Th key={p} className="text-right">
                  {label}
                </Table.Th>
              ))}
              <Table.Th>
                <span className="sr-only">Actions</span>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text size="sm" c="dimmed">
                    Aucun forfait pour ce public : ajoutez une ligne ci-dessous.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {rows.map((l) => {
              const key = `${l.audience}|${l.combination.join("+")}|${l.disciplineId ?? ""}`;
              const label = combinationLabel(l.combination);
              const used = PERIODS.some(([p]) => l.price[p]?.used);
              return (
                <Table.Tr key={key}>
                  <Table.Td>
                    <span className="font-medium">{label}</span>
                    {l.discipline && (
                      <Badge variant="light" ml="xs">
                        {l.discipline} seulement
                      </Badge>
                    )}
                  </Table.Td>
                  {PERIODS.map(([p, periodLabel]) => (
                    <Table.Td key={`${key}-${p}`}>
                      <PriceCell seasonId={seasonId} row={l} period={p} label={`${label}, ${periodLabel}`} />
                    </Table.Td>
                  ))}
                  <Table.Td className="text-right">
                    {!used && (
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="gray"
                        disabled={inProgress}
                        onClick={() => removeRow(l)}
                        aria-label={`Retirer la ligne ${label}`}
                      >
                        Retirer
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Paper>

      <Paper withBorder p="md" className="flex flex-col gap-3 text-sm">
        <Text size="sm" fw={600}>
          Nouvelle ligne ({AUDIENCES.find(([p]) => p === chosenAudience)?.[1].toLowerCase()})
        </Text>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label="Cours de"
            w={120}
            allowDeselect={false}
            data={DURATIONS.map((d) => ({ value: String(d), label: combinationLabel([d]) }))}
            value={duration}
            onChange={(d) => d && setDuration(d)}
          />
          <Button
            variant="default"
            onClick={() => setCombination([...combination, Number(duration)].sort((a, b) => a - b))}
          >
            Ajouter ce cours
          </Button>
          <span className="pb-2" aria-live="polite">
            {combination.length === 0 ? (
              <Text span size="sm" c="dimmed">
                Aucun cours choisi.
              </Text>
            ) : (
              <>
                <span className="font-medium">{combinationLabel(combination)}</span>{" "}
                <Button size="compact-xs" variant="subtle" onClick={() => setCombination([])}>
                  Effacer
                </Button>
              </>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Discipline"
            allowDeselect={false}
            data={[
              { value: "", label: "Toutes" },
              ...disciplines.map((d) => ({ value: d.id, label: `${d.name} seulement` })),
            ]}
            value={disciplineId}
            onChange={(d) => setDisciplineId(d ?? "")}
          />
          {PERIODS.map(([p, label]) => (
            <TextInput
              key={p}
              label={`${label} (€)`}
              inputMode="decimal"
              w={112}
              styles={AMOUNT}
              value={newPrices[p]}
              onChange={(e) => setNewPrice({ ...newPrices, [p]: e.currentTarget.value })}
            />
          ))}
          <Button loading={inProgress} disabled={combination.length === 0} onClick={addRow}>
            Ajouter la ligne
          </Button>
        </div>
        {message && (
          <Text role="alert" size="sm" c="red">
            {message}
          </Text>
        )}
      </Paper>
    </section>
  );
}

export function Siblings({
  seasonId: seasonId,
  siblings: siblings,
}: {
  seasonId: string;
  siblings: SiblingsRule | null;
}) {
  const [v, setV] = useState({
    active: siblings !== null,
    mode: siblings?.amountCents ? "amount" : "rate",
    value: siblings?.amountCents ? inEuros(siblings.amountCents) : siblings?.rateBps ? inEuros(siblings.rateBps) : "10",
    threshold: String(siblings?.minStudents ?? 2),
    audiences: siblings?.audiences ?? (["child"] as Audience[]),
    combinable: siblings?.combinableWithMultiDiscipline ?? false,
  });
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [inProgress, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      // Percentage entered as « 10 » or « 12,5 »: in basis points (1000 = 10 %), without floating-point numbers.
      const value = parseEuros(v.value);
      if (v.active && value === null) return setMessage({ text: "Valeur invalide.", error: true });
      const r = await siblingsRule(
        seasonId,
        v.active
          ? {
              rateBps: v.mode === "rate" ? value : null,
              amountCents: v.mode === "amount" ? value : null,
              minStudents: Number(v.threshold),
              audiences: v.audiences,
              combinableWithMultiDiscipline: v.combinable,
            }
          : null,
      );
      setMessage(r.message ? { text: r.message, error: true } : { text: "Réduction enregistrée.", error: false });
    });

  return (
    <Paper withBorder component="section" aria-labelledby="fratrie" p="md" className="flex flex-col gap-3 text-sm">
      <Title order={2} size="h5" id="fratrie">
        Réduction fratrie
      </Title>
      <Checkbox
        label="Accorder une réduction aux élèves d’un même payeur"
        checked={v.active}
        onChange={(e) => setV({ ...v, active: e.currentTarget.checked })}
      />
      {v.active && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <TextInput
              label="Réduction"
              inputMode="decimal"
              w={96}
              styles={AMOUNT}
              value={v.value}
              onChange={(e) => setV({ ...v, value: e.currentTarget.value })}
            />
            <Select
              aria-label="Unité"
              w={140}
              allowDeselect={false}
              data={[
                { value: "rate", label: "% par élève" },
                { value: "amount", label: "€ par élève" },
              ]}
              value={v.mode}
              onChange={(mode) => mode && setV({ ...v, mode })}
            />
            <Select
              label="À partir de"
              w={120}
              allowDeselect={false}
              data={[2, 3, 4].map((n) => ({ value: String(n), label: `${n} élèves` }))}
              value={v.threshold}
              onChange={(threshold) => threshold && setV({ ...v, threshold })}
            />
          </div>
          <Checkbox.Group
            label="Pour les publics"
            value={v.audiences}
            onChange={(values) =>
              setV({ ...v, audiences: AUDIENCES.flatMap(([p]) => (values.includes(p) ? [p] : [])) })
            }
          >
            <Group gap="md" mt={4}>
              {AUDIENCES.map(([p, label]) => (
                <Checkbox key={p} value={p} label={label} />
              ))}
            </Group>
          </Checkbox.Group>
          <Checkbox
            label="Cumulable avec un forfait de plusieurs disciplines"
            checked={v.combinable}
            onChange={(e) => setV({ ...v, combinable: e.currentTarget.checked })}
          />
        </>
      )}
      <Button className="self-start" loading={inProgress} onClick={save}>
        Enregistrer
      </Button>
      {message && (
        <Text role={message.error ? "alert" : "status"} size="sm" c={message.error ? "red" : undefined}>
          {message.text}
        </Text>
      )}
    </Paper>
  );
}

export function LessonPacks({
  seasonId: seasonId,
  lessonPacks: lessonPacks,
}: {
  seasonId: string;
  lessonPacks: LessonPackRow[];
}) {
  const [v, setV] = useState({ lessonCount: "5", maxPeople: "1", price: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const act = (action: () => Promise<{ message: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) after?.();
    });

  return (
    <Paper withBorder component="section" aria-labelledby="carnets" p="md" className="flex flex-col gap-3 text-sm">
      <Title order={2} size="h5" id="carnets">
        Carnets de cours particuliers
      </Title>
      {lessonPacks.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun carnet pour cette saison.
        </Text>
      ) : (
        <ul className="divide-y divide-bordure rounded-md border border-bordure">
          {lessonPacks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
              <span className="font-medium">
                {c.lessonCount} séance{c.lessonCount > 1 ? "s" : ""}
              </span>
              <Text span size="sm" c="dimmed">
                {c.maxPeople === 1 ? "1 personne" : `jusqu’à ${c.maxPeople} personnes`}
              </Text>
              <span className="tabular-nums">{formatEuros(c.priceCents)}</span>
              <Button
                size="compact-sm"
                variant="subtle"
                color="gray"
                className="ml-auto"
                disabled={inProgress}
                onClick={() => act(() => removeLessonPack(c.id))}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const price = parseEuros(v.price);
          if (price === null) return setMessage("Montant en euros, par exemple 250.");
          act(
            () =>
              lessonPack(seasonId, {
                lessonCount: Number(v.lessonCount),
                maxPeople: Number(v.maxPeople),
                priceCents: price,
              }),
            () => setV({ ...v, price: "" }),
          );
        }}
      >
        <NumberInput
          label="Séances"
          w={88}
          min={1}
          allowDecimal={false}
          value={v.lessonCount}
          onChange={(n) => setV({ ...v, lessonCount: String(n) })}
        />
        <NumberInput
          label="Personnes (max)"
          w={120}
          min={1}
          allowDecimal={false}
          value={v.maxPeople}
          onChange={(n) => setV({ ...v, maxPeople: String(n) })}
        />
        <TextInput
          label="Prix (€)"
          inputMode="decimal"
          w={112}
          styles={AMOUNT}
          value={v.price}
          onChange={(e) => setV({ ...v, price: e.currentTarget.value })}
        />
        <Button type="submit" variant="default" loading={inProgress}>
          Enregistrer le carnet
        </Button>
      </form>
      <Text size="xs" c="dimmed">
        Même nombre de séances et de personnes : le prix est mis à jour.
      </Text>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </Paper>
  );
}
