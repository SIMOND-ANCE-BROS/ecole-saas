"use client";

import { Button, Text, TextInput } from "@mantine/core";
import { MAX_PRICE_CENTS, MAX_REASON_LENGTH, NO_GRID_PRICE } from "@/domain/enrollment/manual-price";
import { formatEuros, parseEuros, typedEuros } from "@/lib/money";

/** What the front desk typed for one enrollment (#292); `price` as typed, in euros. */
export type TypedPrice = { price: string; reason: string };

/** The typed price read: cents and whether it can be sent. */
export function readTypedPrice(computedNetCents: number | null, typed: TypedPrice | null) {
  if (typed === null) return { cents: null, differs: false, valid: computedNetCents !== null, problem: null };
  const cents = typed.price.trim() === "" ? null : parseEuros(typed.price);
  const differs = cents !== null && cents !== computedNetCents;
  const problem =
    typed.price.trim() === ""
      ? computedNetCents === null
        ? NO_GRID_PRICE
        : "Indiquez le prix"
      : cents === null
        ? "Montant non reconnu"
        : cents > MAX_PRICE_CENTS
          ? `Prix trop élevé (${formatEuros(MAX_PRICE_CENTS)} au plus)`
          : null;
  return { cents, differs, valid: problem === null && (!differs || typed.reason.trim() !== ""), problem };
}

/**
 * « Modifier le prix » of one enrollment (#292): a price typed instead of the computed
 * one, with a required reason; the computed price stays shown for comparison. Without
 * a package in the grid (`computedNetCents` null), the price is typed directly.
 */
export function ManualPriceField({
  id,
  computedNetCents,
  typed,
  onChange,
  tried,
}: {
  /** Unique per enrollment of the form, for the field ids. */
  id: string;
  computedNetCents: number | null;
  typed: TypedPrice | null;
  onChange: (typed: TypedPrice | null) => void;
  /** The front desk tried to save: missing values are said. */
  tried: boolean;
}) {
  if (typed === null)
    return computedNetCents === null ? null : (
      <Button
        variant="subtle"
        size="compact-sm"
        className="self-start"
        onClick={() => {
          onChange({ price: typedEuros(computedNetCents), reason: "" });
          // The amount is what changes: focus goes to it, selected.
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`#${id}-prix`)?.select());
        }}
      >
        Modifier le prix
      </Button>
    );
  const read = readTypedPrice(computedNetCents, typed);
  return (
    <div className="flex flex-col gap-2">
      <TextInput
        id={`${id}-prix`}
        label="Prix saisi (€)"
        required
        inputMode="decimal"
        styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
        value={typed.price}
        onChange={(e) => onChange({ ...typed, price: e.currentTarget.value })}
        description={
          computedNetCents === null
            ? "Pas de forfait dans la grille : saisissez le prix"
            : `Prix calculé : ${formatEuros(computedNetCents)}. Le prix saisi est le prix final.`
        }
        error={read.problem && (tried || typed.price.trim() !== "") ? read.problem : undefined}
      />
      {(read.differs || computedNetCents === null) && (
        <TextInput
          id={`${id}-motif`}
          label="Motif du prix"
          description="Gardé dans l’historique de l’inscription : sans nom ni donnée personnelle."
          required
          maxLength={MAX_REASON_LENGTH}
          value={typed.reason}
          onChange={(e) => onChange({ ...typed, reason: e.currentTarget.value })}
          error={tried && typed.reason.trim() === "" ? "Indiquez le motif" : undefined}
        />
      )}
      {computedNetCents !== null && (
        <Button variant="subtle" size="compact-sm" className="self-start" onClick={() => onChange(null)}>
          Revenir au prix calculé
        </Button>
      )}
      {read.differs && read.cents !== null && (
        <Text size="sm" fw={600} className="flex justify-between gap-2">
          <span>Prix retenu</span>
          <span className="tabular-nums">{formatEuros(read.cents)}</span>
        </Text>
      )}
    </div>
  );
}
