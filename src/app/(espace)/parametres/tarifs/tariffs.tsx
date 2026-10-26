"use client";

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
        <input
          aria-label={label}
          inputMode="decimal"
          className={`champ w-24 text-right tabular-nums ${state === "error" ? "border-erreur" : ""}`}
          value={value}
          placeholder="—"
          disabled={inProgress}
          onChange={(e) => {
            setValue(e.target.value);
            setState(null);
          }}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
        />
        <span className="w-3 text-xs" aria-hidden>
          {state === "saved" ? "✓" : "€"}
        </span>
      </div>
      {current?.used && <span className="text-[11px] text-doux">déjà utilisé</span>}
      {message && (
        <span role="alert" className="max-w-40 text-right text-[11px] text-erreur">
          {message}
        </span>
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
      <h2 id="grille" className="text-base font-semibold">
        Grille des forfaits
      </h2>
      <div role="tablist" aria-label="Public" className="flex flex-wrap gap-1">
        {AUDIENCES.map(([p, label]) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={chosenAudience === p}
            className="rounded-md border border-bordure px-3 py-1.5 text-sm aria-selected:border-accent aria-selected:bg-accent-doux aria-selected:font-medium"
            onClick={() => setAudience(p)}
          >
            {label} <span className="text-doux">({grid.filter((l) => l.audience === p).length})</span>
          </button>
        ))}
      </div>

      <div className="panneau overflow-x-auto">
        <table className="tableau">
          <thead>
            <tr>
              <th>Cours de la semaine</th>
              {PERIODS.map(([p, label]) => (
                <th key={p} className="text-right">
                  {label}
                </th>
              ))}
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-doux">
                  Aucun forfait pour ce public : ajoutez une ligne ci-dessous.
                </td>
              </tr>
            )}
            {rows.map((l) => {
              const key = `${l.audience}|${l.combination.join("+")}|${l.disciplineId ?? ""}`;
              const label = combinationLabel(l.combination);
              const used = PERIODS.some(([p]) => l.price[p]?.used);
              return (
                <tr key={key}>
                  <td>
                    <span className="font-medium">{label}</span>
                    {l.discipline && (
                      <span className="ml-2 rounded bg-accent-doux px-1.5 text-xs">{l.discipline} seulement</span>
                    )}
                  </td>
                  {PERIODS.map(([p, periodLabel]) => (
                    <td key={`${key}-${p}`}>
                      <PriceCell seasonId={seasonId} row={l} period={p} label={`${label}, ${periodLabel}`} />
                    </td>
                  ))}
                  <td className="text-right">
                    {!used && (
                      <button
                        type="button"
                        className="lien text-xs text-doux"
                        disabled={inProgress}
                        onClick={() => removeRow(l)}
                        aria-label={`Retirer la ligne ${label}`}
                      >
                        Retirer
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panneau flex flex-col gap-3 p-4 text-sm">
        <p className="font-semibold">
          Nouvelle ligne ({AUDIENCES.find(([p]) => p === chosenAudience)?.[1].toLowerCase()})
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="duree">Cours de</label>
            <select id="duree" className="champ" value={duration} onChange={(e) => setDuration(e.target.value)}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {combinationLabel([d])}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="bouton-secondaire"
            onClick={() => setCombination([...combination, Number(duration)].sort((a, b) => a - b))}
          >
            Ajouter ce cours
          </button>
          <span className="pb-2" aria-live="polite">
            {combination.length === 0 ? (
              <span className="text-doux">Aucun cours choisi.</span>
            ) : (
              <>
                <span className="font-medium">{combinationLabel(combination)}</span>{" "}
                <button type="button" className="lien text-xs" onClick={() => setCombination([])}>
                  Effacer
                </button>
              </>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="discipline-ligne">Discipline</label>
            <select
              id="discipline-ligne"
              className="champ"
              value={disciplineId}
              onChange={(e) => setDisciplineId(e.target.value)}
            >
              <option value="">Toutes</option>
              {disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} seulement
                </option>
              ))}
            </select>
          </div>
          {PERIODS.map(([p, label]) => (
            <div key={p} className="flex flex-col gap-1">
              <label htmlFor={`prix-${p}`}>{label} (€)</label>
              <input
                id={`prix-${p}`}
                inputMode="decimal"
                className="champ w-28 text-right"
                value={newPrices[p]}
                onChange={(e) => setNewPrice({ ...newPrices, [p]: e.target.value })}
              />
            </div>
          ))}
          <button
            type="button"
            className="bouton-principal"
            disabled={inProgress || combination.length === 0}
            onClick={addRow}
          >
            Ajouter la ligne
          </button>
        </div>
        {message && (
          <p role="alert" className="text-erreur">
            {message}
          </p>
        )}
      </div>
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
    <section aria-labelledby="fratrie" className="panneau flex flex-col gap-3 p-4 text-sm">
      <h2 id="fratrie" className="text-base font-semibold">
        Réduction fratrie
      </h2>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
        Accorder une réduction aux élèves d’un même payeur
      </label>
      {v.active && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="fratrie-valeur">Réduction</label>
              <input
                id="fratrie-valeur"
                inputMode="decimal"
                className="champ w-24 text-right"
                value={v.value}
                onChange={(e) => setV({ ...v, value: e.target.value })}
              />
            </div>
            <label className="sr-only" htmlFor="fratrie-mode">
              Unité
            </label>
            <select
              id="fratrie-mode"
              className="champ"
              value={v.mode}
              onChange={(e) => setV({ ...v, mode: e.target.value })}
            >
              <option value="rate">% par élève</option>
              <option value="amount">€ par élève</option>
            </select>
            <div className="flex flex-col gap-1">
              <label htmlFor="fratrie-seuil">À partir de</label>
              <select
                id="fratrie-seuil"
                className="champ"
                value={v.threshold}
                onChange={(e) => setV({ ...v, threshold: e.target.value })}
              >
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} élèves
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1">Pour les publics</legend>
            {AUDIENCES.map(([p, label]) => (
              <label key={p} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.audiences.includes(p)}
                  onChange={(e) =>
                    setV({
                      ...v,
                      audiences: e.target.checked ? [...v.audiences, p] : v.audiences.filter((x) => x !== p),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v.combinable}
              onChange={(e) => setV({ ...v, combinable: e.target.checked })}
            />
            Cumulable avec un forfait de plusieurs disciplines
          </label>
        </>
      )}
      <button type="button" className="bouton-principal self-start" disabled={inProgress} onClick={save}>
        Enregistrer
      </button>
      {message && (
        <p role={message.error ? "alert" : "status"} className={message.error ? "text-erreur" : ""}>
          {message.text}
        </p>
      )}
    </section>
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
    <section aria-labelledby="carnets" className="panneau flex flex-col gap-3 p-4 text-sm">
      <h2 id="carnets" className="text-base font-semibold">
        Carnets de cours particuliers
      </h2>
      {lessonPacks.length === 0 ? (
        <p className="text-doux">Aucun carnet pour cette saison.</p>
      ) : (
        <ul className="divide-y divide-bordure rounded-md border border-bordure">
          {lessonPacks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
              <span className="font-medium">
                {c.lessonCount} séance{c.lessonCount > 1 ? "s" : ""}
              </span>
              <span className="text-doux">{c.maxPeople === 1 ? "1 personne" : `jusqu’à ${c.maxPeople} personnes`}</span>
              <span className="tabular-nums">{formatEuros(c.priceCents)}</span>
              <button
                type="button"
                className="lien ml-auto text-xs text-doux"
                disabled={inProgress}
                onClick={() => act(() => removeLessonPack(c.id))}
              >
                Retirer
              </button>
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
        <div className="flex flex-col gap-1">
          <label htmlFor="carnet-seances">Séances</label>
          <input
            id="carnet-seances"
            type="number"
            min={1}
            className="champ w-20"
            value={v.lessonCount}
            onChange={(e) => setV({ ...v, lessonCount: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="carnet-personnes">Personnes (max)</label>
          <input
            id="carnet-personnes"
            type="number"
            min={1}
            className="champ w-20"
            value={v.maxPeople}
            onChange={(e) => setV({ ...v, maxPeople: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="carnet-prix">Prix (€)</label>
          <input
            id="carnet-prix"
            inputMode="decimal"
            className="champ w-28 text-right"
            value={v.price}
            onChange={(e) => setV({ ...v, price: e.target.value })}
          />
        </div>
        <button type="submit" className="bouton-secondaire" disabled={inProgress}>
          Enregistrer le carnet
        </button>
      </form>
      <p className="text-xs text-doux">Même nombre de séances et de personnes : le prix est mis à jour.</p>
      {message && (
        <p role="alert" className="text-erreur">
          {message}
        </p>
      )}
    </section>
  );
}
