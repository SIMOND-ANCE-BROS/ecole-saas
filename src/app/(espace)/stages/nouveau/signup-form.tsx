"use client";

import { Button, Checkbox, Select, Text, TextInput } from "@mantine/core";
import { useRef, useState, useTransition } from "react";
import { Cancel } from "@/app/(espace)/_panel/panel";
import { CheckSaved } from "@/app/(espace)/_ui/check-saved";
import type { WorkshopChoice } from "@/db/workshops";
import {
  MAX_PRICE_CENTS,
  MAX_REASON_LENGTH,
  NO_WORKSHOP_PRICE,
  REASON_REQUIRED,
  placesLeft,
  signupDueCents,
  signupPriceDiffers,
} from "@/domain/workshop/signup";
import { orConnectionLost } from "@/lib/action-result";
import { formatEuros, parseEuros, typedEuros } from "@/lib/money";
import { signUp } from "../actions";

type Student = { id: string; firstName: string; name: string };
type Props = {
  payerId: string;
  students: Student[];
  initialStudent: string | null;
  workshops: WorkshopChoice[];
  /** The school has several businesses: the one selling the workshop is named. */
  showEntity: boolean;
  back: string;
};

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dayOf = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));

/** « sam. 13 févr. 2027 », « sam. 13 févr. 2027 et 2 autres dates ». */
function whenOf(w: WorkshopChoice): string {
  if (w.dates.length === 0) return "chaque semaine";
  const others = w.dates.length - 1;
  return others === 0
    ? dayOf(w.dates[0])
    : `${dayOf(w.dates[0])} et ${others} autre${others > 1 ? "s" : ""} date${others > 1 ? "s" : ""}`;
}

/**
 * Sign-up for a workshop (#297): the workshop, the students it is for, the price per
 * participant set on the workshop (editable with a reason). Fully typable: Tab moves through
 * the fields, Enter signs up.
 */
export function SignupForm({ payerId, students, initialStudent, workshops, showEntity, back }: Props) {
  const [workshopId, setWorkshopId] = useState(workshops.length === 1 ? workshops[0].id : "");
  const [participants, setParticipants] = useState<string[]>(initialStudent ? [initialStudent] : []);
  // null: the price follows the workshop's; otherwise what was typed.
  const [typedPrice, setTypedPrice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // The server knew a newer price and asks for a reason: the reason field shows too.
  const [askReason, setAskReason] = useState(false);
  const [tried, setTried] = useState(false);
  const [sending, startTransition] = useTransition();
  // Same key for every attempt of this sign-up: a retry after a lost response signs up once (#260).
  const [key] = useState(() => crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);

  const workshop = workshops.find((w) => w.id === workshopId) ?? null;
  const workshopPriceCents = workshop?.priceCents ?? null;
  const price = typedPrice ?? (workshopPriceCents !== null ? typedEuros(workshopPriceCents) : "");
  const priceCents = price.trim() === "" ? null : parseEuros(price);
  const unreadable = price.trim() !== "" && priceCents === null;
  const tooHigh = priceCents !== null && priceCents > MAX_PRICE_CENTS;
  const differs = (priceCents !== null && signupPriceDiffers({ workshopPriceCents, priceCents })) || askReason;
  const totalCents =
    priceCents !== null && !unreadable && participants.length > 0
      ? signupDueCents({ unitPriceCents: priceCents, participantCount: participants.length })
      : null;
  const left = workshop ? placesLeft(workshop) : null;
  const full = left !== null && participants.length > left;

  const focusError = () =>
    requestAnimationFrame(() =>
      form.current?.querySelector<HTMLElement>('[data-missing="true"] input, [aria-invalid="true"]')?.focus(),
    );

  return (
    <form
      ref={form}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        setMessage(null);
        if (
          !workshop ||
          participants.length === 0 ||
          unreadable ||
          tooHigh ||
          priceCents === null ||
          (differs && reason.trim() === "")
        ) {
          focusError();
          return;
        }
        const entry = { courseId: workshop.id, participantIds: participants, priceCents, reason };
        startTransition(async () => {
          const r = await orConnectionLost(
            () => signUp(payerId, entry, back, key),
            (m) => ({ message: m }),
          );
          if (r.message === REASON_REQUIRED) {
            setAskReason(true);
            focusError();
          } else setMessage(r.message);
        });
      }}
    >
      <Select
        label="Stage"
        required
        searchable
        allowDeselect={false}
        placeholder="Choisissez le stage"
        nothingFoundMessage="Aucun stage"
        data={workshops.map((w) => ({
          value: w.id,
          label: `${w.label} — ${whenOf(w)}`,
        }))}
        value={workshopId || null}
        onChange={(v) => {
          setWorkshopId(v ?? workshopId);
          // Another workshop, another price: a price typed for the previous one never stays unnoticed.
          setTypedPrice(null);
          setReason("");
          setAskReason(false);
          setMessage(null);
        }}
        error={tried && !workshop ? "Choisissez le stage" : undefined}
        data-missing={tried && !workshop}
        data-panel-focus={workshops.length > 1 || undefined}
        autoFocus={workshops.length > 1}
      />
      {workshop && (
        <Text size="sm" c="dimmed">
          {workshop.dates.length > 1 && `${workshop.dates.map(dayOf).join(", ")} · `}
          {workshop.startTime.replace(":", " h ")} · {workshop.durationMinutes} min
          {left !== null && ` · ${left} place${left > 1 ? "s" : ""} libre${left > 1 ? "s" : ""}`}
          {showEntity && ` · ${workshop.entity}`}
        </Text>
      )}

      <Checkbox.Group
        label="Participants"
        value={participants}
        onChange={setParticipants}
        error={tried && participants.length === 0 ? "Choisissez au moins un élève" : undefined}
        data-missing={tried && participants.length === 0}
      >
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {students.map((s, i) => (
            <Checkbox
              key={s.id}
              value={s.id}
              label={`${s.firstName} ${s.name}`}
              data-panel-focus={(workshops.length <= 1 && i === 0) || undefined}
              autoFocus={workshops.length <= 1 && i === 0}
            />
          ))}
        </div>
      </Checkbox.Group>
      {full && (
        <Text size="sm" c="orange.8" role="status">
          Plus assez de places libres sur ce stage : l’inscription reste possible.
        </Text>
      )}

      <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-start">
        <TextInput
          label="Prix par participant (€)"
          required
          inputMode="decimal"
          autoComplete="off"
          styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
          value={price}
          onChange={(e) => setTypedPrice(e.currentTarget.value)}
          description={
            workshopPriceCents !== null
              ? `Prix du stage : ${formatEuros(workshopPriceCents)}`
              : workshop
                ? "Pas de prix sur ce stage : saisissez-le"
                : undefined
          }
          error={
            unreadable
              ? "Montant non reconnu"
              : tooHigh
                ? `Prix trop élevé (${formatEuros(MAX_PRICE_CENTS)} au plus)`
                : tried && workshop && priceCents === null
                  ? workshopPriceCents === null
                    ? NO_WORKSHOP_PRICE
                    : "Indiquez le prix"
                  : undefined
          }
        />
        {differs && (
          <TextInput
            label="Motif du prix"
            description="Gardé dans l’historique de l’inscription : sans nom ni donnée personnelle."
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
      <CheckSaved message={message} href={back} label="Voir les stages de la fiche" safeRetry />
      <div className="flex flex-wrap gap-2 border-t border-bordure pt-4">
        <Button type="submit" loading={sending}>
          {totalCents !== null && !tooHigh ? `Inscrire — ${formatEuros(totalCents)}` : "Inscrire"}
        </Button>
        <Cancel href={back} />
      </div>
    </form>
  );
}
