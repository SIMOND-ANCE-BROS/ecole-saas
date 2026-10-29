"use client";

import { Button, Checkbox, NumberInput, Text, TextInput } from "@mantine/core";
import { useRef, useState, useTransition } from "react";
import { Cancel } from "@/app/(espace)/_panel/panel";
import { CheckSaved } from "@/app/(espace)/_ui/check-saved";
import {
  MAX_LESSONS,
  MAX_PEOPLE,
  MAX_PRICE_CENTS,
  MAX_REASON_LENGTH,
  NO_GRID_PRICE,
  priceDiffers,
  REASON_REQUIRED,
} from "@/domain/lesson-pack/pack";
import { priceLessonPack } from "@/domain/tariff/lesson-pack";
import type { LessonPackTariffRow } from "@/domain/tariff/types";
import { orConnectionLost } from "@/lib/action-result";
import { formatEuros, parseEuros, typedEuros } from "@/lib/money";
import { sellPack } from "../actions";

type Student = { id: string; firstName: string; name: string };
type Props = {
  payerId: string;
  students: Student[];
  initialStudent: string | null;
  grid: LessonPackTariffRow[];
  back: string;
};

const count = (v: string | number) => (typeof v === "number" && Number.isInteger(v) ? v : null);
const list = (ns: number[]) => (ns.length <= 1 ? ns.join("") : `${ns.slice(0, -1).join(", ")} ou ${ns[ns.length - 1]}`);

/**
 * Sale of a lesson pack (#286): the students it is for, the number of lessons and of
 * people, the price of the grid (editable with a reason). Fully typable: Tab moves
 * through the fields, Enter sells.
 */
export function SaleForm({ payerId, students, initialStudent, grid, back }: Props) {
  const lessonCounts = [...new Set(grid.map((r) => r.lessonCount))].sort((a, b) => a - b);
  const [participants, setParticipants] = useState<string[]>(initialStudent ? [initialStudent] : []);
  const [lessons, setLessons] = useState<string | number>(lessonCounts.at(-1) ?? 10);
  const [people, setPeople] = useState<string | number>(Math.max(participants.length, 1));
  // null: the price follows the grid; otherwise what was typed.
  const [typedPrice, setTypedPrice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // The server knew a newer grid and asks for a reason: the reason field shows too.
  const [askReason, setAskReason] = useState(false);
  const [tried, setTried] = useState(false);
  const [sending, startTransition] = useTransition();
  // Same key for every attempt of this sale: a retry after a lost response sells nothing twice (#260).
  const [key] = useState(() => crypto.randomUUID());

  const lessonCount = count(lessons);
  const peopleCount = count(people);
  const priced = lessonCount && peopleCount ? priceLessonPack(grid, { lessonCount, peopleCount }) : null;
  const gridPriceCents = priced?.status === "ok" ? priced.priceCents : null;
  const price = typedPrice ?? (gridPriceCents !== null ? typedEuros(gridPriceCents) : "");
  const priceCents = price.trim() === "" ? null : parseEuros(price);
  const unreadable = price.trim() !== "" && priceCents === null;
  const tooHigh = priceCents !== null && priceCents > MAX_PRICE_CENTS;
  // An empty price is missing, not different: the price field says so, not the reason.
  const differs = (priceCents !== null && priceDiffers({ gridPriceCents, priceCents })) || askReason;
  const tooMany = peopleCount !== null && participants.length > peopleCount;

  const largest = lessonCounts.at(-1);
  const beyondGrid = lessonCount !== null && largest !== undefined && lessonCount > largest;
  const form = useRef<HTMLFormElement>(null);

  // Another pack, another price: a price typed for the previous one never stays unnoticed.
  const followGrid = () => {
    setTypedPrice(null);
    setReason("");
    setAskReason(false);
    setMessage(null);
  };
  // A refused entry: focus goes to the first field in error, once it is drawn.
  const focusError = () =>
    requestAnimationFrame(() =>
      form.current?.querySelector<HTMLElement>('[data-missing="true"] input, [aria-invalid="true"]')?.focus(),
    );

  const choose = (ids: string[]) => {
    setParticipants(ids);
    // More students than people: the pack is for at least as many people as named students.
    if (peopleCount === null || ids.length > peopleCount) {
      setPeople(Math.max(ids.length, 1));
      followGrid();
    }
  };

  return (
    <form
      ref={form}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        // Refused here: the field says why; the message line is for the server's answers.
        setMessage(null);
        if (
          participants.length === 0 ||
          lessonCount === null ||
          peopleCount === null ||
          tooMany ||
          unreadable ||
          tooHigh ||
          priceCents === null ||
          (differs && reason.trim() === "")
        ) {
          focusError();
          return;
        }
        const entry = { lessonCount, peopleCount, participantIds: participants, priceCents, reason };
        startTransition(async () => {
          const r = await orConnectionLost(
            () => sellPack(payerId, entry, back, key),
            (m) => ({ message: m }),
          );
          if (r.message === REASON_REQUIRED) {
            setAskReason(true);
            focusError();
          } else setMessage(r.message);
        });
      }}
    >
      <Checkbox.Group
        label="Pour"
        description="Les séances de ces élèves pourront être décomptées sur le carnet."
        value={participants}
        onChange={choose}
        error={tried && participants.length === 0 ? "Choisissez au moins un élève" : undefined}
        data-missing={tried && participants.length === 0}
      >
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {students.map((s, i) => (
            <Checkbox
              key={s.id}
              value={s.id}
              label={`${s.firstName} ${s.name}`}
              data-panel-focus={i === 0 || undefined}
              // Full page too (the panel focuses `data-panel-focus` itself).
              autoFocus={i === 0}
            />
          ))}
        </div>
      </Checkbox.Group>

      <div className="grid gap-3 sm:grid-cols-[12rem_12rem]">
        <NumberInput
          label="Nombre de séances"
          description={
            beyondGrid
              ? `Au-delà de la grille (${largest} séances au plus) : vérifiez`
              : lessonCounts.length > 0
                ? `Grille : ${list(lessonCounts)} séances`
                : undefined
          }
          required
          min={1}
          max={MAX_LESSONS}
          allowDecimal={false}
          allowNegative={false}
          value={lessons}
          onChange={(v) => {
            setLessons(v);
            followGrid();
          }}
          error={tried && lessonCount === null ? "Indiquez le nombre de séances" : undefined}
        />
        <NumberInput
          label="Nombre de personnes"
          description="Élèves choisis et invités"
          required
          min={1}
          max={MAX_PEOPLE}
          allowDecimal={false}
          allowNegative={false}
          value={people}
          onChange={(v) => {
            setPeople(v);
            followGrid();
          }}
          error={
            tooMany
              ? `Au moins ${participants.length}, le nombre d’élèves choisis`
              : tried && peopleCount === null
                ? "Indiquez le nombre de personnes"
                : undefined
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-start">
        <TextInput
          label="Prix (€)"
          required
          inputMode="decimal"
          styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
          value={price}
          onChange={(e) => setTypedPrice(e.currentTarget.value)}
          description={
            gridPriceCents !== null
              ? `Grille : ${formatEuros(gridPriceCents)}`
              : lessonCount && peopleCount
                ? "Pas de prix dans la grille : saisissez-le"
                : undefined
          }
          error={
            unreadable
              ? "Montant non reconnu"
              : tooHigh
                ? `Prix trop élevé (${formatEuros(MAX_PRICE_CENTS)} au plus)`
                : tried && priceCents === null
                  ? gridPriceCents === null
                    ? NO_GRID_PRICE
                    : "Indiquez le prix"
                  : undefined
          }
        />
        {differs && (
          <TextInput
            label="Motif du prix"
            description="Gardé dans l’historique du carnet : sans nom ni donnée personnelle."
            required
            maxLength={MAX_REASON_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            error={(tried || askReason) && reason.trim() === "" ? "Indiquez le motif" : undefined}
          />
        )}
      </div>

      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      <CheckSaved message={message} href={back} label="Voir les carnets de la fiche" safeRetry />
      <div className="flex flex-wrap gap-2 border-t border-bordure pt-4">
        <Button type="submit" loading={sending}>
          {priceCents !== null && !unreadable ? `Vendre le carnet ${formatEuros(priceCents)}` : "Vendre le carnet"}
        </Button>
        <Cancel href={back} />
      </div>
    </form>
  );
}
