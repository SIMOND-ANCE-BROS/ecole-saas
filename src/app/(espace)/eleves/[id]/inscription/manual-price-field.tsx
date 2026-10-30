"use client";

import { Button, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import { MAX_REASON_LENGTH, PRICE_TOO_HIGH, readTypedPrice, type TypedPrice } from "@/domain/enrollment/manual-price";
import { formatEuros, typedEuros } from "@/lib/money";

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
  quarterCount = 0,
}: {
  /**
   * Quarters a quarterly enrollment covers (#291): the typed price is then one quarter's,
   * owed for each of them. 0 for any other period.
   */
  quarterCount?: number;
  /** Unique per enrollment of the form, for the field ids. */
  id: string;
  computedNetCents: number | null;
  typed: TypedPrice | null;
  onChange: (typed: TypedPrice | null) => void;
  /** The front desk tried to save: missing values are said. */
  tried: boolean;
}) {
  // The amount was left once: an unreadable amount is said then, not while typing « 80, ».
  const [left, setLeft] = useState(false);
  if (typed === null)
    return computedNetCents === null ? null : (
      <Button
        id={`${id}-modifier`}
        variant="subtle"
        size="compact-sm"
        className="self-start"
        onClick={() => {
          setLeft(false);
          onChange({ price: typedEuros(computedNetCents), reason: "" });
          // The amount is what changes: focus goes to it, selected.
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`#${id}-prix`)?.select());
        }}
      >
        Modifier le prix
      </Button>
    );
  const read = readTypedPrice(computedNetCents, typed);
  const shown = read.problem === PRICE_TOO_HIGH || tried || (left && typed.price.trim() !== "");
  return (
    <div className="flex flex-col gap-2">
      <TextInput
        id={`${id}-prix`}
        label={quarterCount > 0 ? "Prix par trimestre (€)" : "Prix saisi (€)"}
        required
        inputMode="decimal"
        styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
        value={typed.price}
        onChange={(e) => onChange({ ...typed, price: e.currentTarget.value })}
        onBlur={() => setLeft(true)}
        // Off the grid, the message above already says the price is to be typed.
        description={
          quarterCount > 0
            ? `Dû pour chacun des ${quarterCount} trimestre${quarterCount > 1 ? "s" : ""} restant${quarterCount > 1 ? "s" : ""}.`
            : computedNetCents === null
              ? undefined
              : "Le prix saisi remplace le prix calculé."
        }
        error={read.problem && shown ? read.problem : undefined}
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
        <Button
          variant="subtle"
          size="compact-sm"
          className="self-start"
          onClick={() => {
            onChange(null);
            // The fields go away: focus goes back to « Modifier le prix », drawn again in their place.
            requestAnimationFrame(() => document.getElementById(`${id}-modifier`)?.focus());
          }}
        >
          Revenir au prix calculé
        </Button>
      )}
      {read.differs && read.cents !== null && (
        <Text size="sm" fw={600} className="flex justify-between gap-2">
          <span>{quarterCount > 0 ? "Prix retenu par trimestre" : "Prix retenu"}</span>
          <span className="tabular-nums">{formatEuros(read.cents)}</span>
        </Text>
      )}
    </div>
  );
}
