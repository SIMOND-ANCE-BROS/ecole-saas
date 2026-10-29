"use client";

import { Button, Group, Loader, Modal, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState, useTransition } from "react";
import type { ConfirmationPreview, ExistingImpact } from "@/db/enrollments";
import { dropDateBounds, type EnrollmentActions } from "@/domain/enrollment/lifecycle";
import { NOT_SAVED, settle } from "@/lib/action-result";
import { ofName } from "@/lib/french";
import { formatEuros } from "@/lib/money";
import { DateField, refusedDateField } from "../_ui/date-field";
import {
  cancelAction,
  confirmAction,
  confirmationPreviewAction,
  dropAction,
  leavingImpactsAction,
} from "./enrollment-actions";
import { ENROLLMENTS_HEADING } from "./enrollment-status";
import { DiscountImpacts, PriceDetail } from "./price-detail";

type Change = "confirm" | "drop" | "cancel";

export type ChangeableEnrollment = {
  id: string;
  /** « Zoé », « Léa et Hugo ». */
  students: string;
  courses: string[];
  netPriceCents: number;
  /** Why it cannot be cancelled (invoiced, attended), shown instead of « Annuler… »; null when it can. */
  cancelRefusal: string | null;
  /** Day it was entered: a drop-out cannot be dated before. */
  enrolledOn: string;
  actions: EnrollmentActions;
};

type Props = {
  enrollment: ChangeableEnrollment;
  today: string;
  /** The enrollment's season: a drop-out is dated within it. */
  season: { startDate: string; endDate: string };
};

/**
 * Status changes of a saved enrollment (#284), as buttons in its row: each opens a
 * short dialog that shows what will change before saving. The dialog starts on its
 * safe button (« Fermer », « Garder l’inscription »), so Enter by reflex changes
 * nothing; Escape closes it.
 */
export function EnrollmentChanges({ enrollment, today, season }: Props) {
  // The open dialog, and the button that opened it: focus goes back to it when the dialog closes without a change.
  const [opened, setOpened] = useState<{ change: Change; opener: HTMLButtonElement } | null>(null);
  const { confirm, drop, cancel } = enrollment.actions;
  const of = ofName(enrollment.students);
  return (
    <>
      <div className="flex flex-wrap gap-1 sm:justify-end">
        {confirm && (
          <Button
            size="compact-sm"
            variant="light"
            aria-label={`Confirmer l’inscription ${of}`}
            onClick={(e) => setOpened({ change: "confirm", opener: e.currentTarget })}
          >
            Confirmer…
          </Button>
        )}
        {drop && (
          <Button
            size="compact-sm"
            variant="subtle"
            aria-label={`Enregistrer l’abandon ${of}`}
            onClick={(e) => setOpened({ change: "drop", opener: e.currentTarget })}
          >
            Abandonner…
          </Button>
        )}
        {cancel ? (
          <Button
            size="compact-sm"
            variant="subtle"
            color="red"
            aria-label={`Annuler l’inscription ${of}`}
            onClick={(e) => setOpened({ change: "cancel", opener: e.currentTarget })}
          >
            Annuler…
          </Button>
        ) : (
          <Text span size="xs" c="dimmed">
            {enrollment.cancelRefusal}
          </Text>
        )}
      </div>
      {opened && (
        <ChangeDialog
          change={opened.change}
          enrollment={enrollment}
          today={today}
          season={season}
          onClose={(saved) => {
            const { opener } = opened;
            setOpened(null);
            // After a change the button may be gone: the save gives focus to the section heading.
            if (!saved) requestAnimationFrame(() => opener.focus());
          }}
        />
      )}
    </>
  );
}

const TITLES: Record<Change, string> = {
  confirm: "Confirmer l’inscription",
  drop: "Enregistrer un abandon",
  cancel: "Annuler l’inscription",
};

const DONE: Record<Change, string> = {
  confirm: "Inscription confirmée",
  drop: "Abandon enregistré",
  cancel: "Inscription annulée",
};

/** A drop-out date to start from: today, within the allowed days. */
const within = (today: string, b: { min: string; max: string }) =>
  today < b.min ? b.min : today > b.max ? b.max : today;

function ChangeDialog({
  change,
  enrollment,
  today,
  season,
  onClose,
}: Props & { change: Change; onClose: (saved: boolean) => void }) {
  const router = useRouter();
  // What the change would do, read when the dialog opens; `attempt` reads it again.
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; preview: Preview } | null>(null);
  const bounds = dropDateBounds(enrollment.enrolledOn, season);
  const [droppedOn, setDroppedOn] = useState(within(today, bounds));
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startSending] = useTransition();

  useEffect(() => {
    let active = true;
    void loadPreview(change, enrollment.id).then((preview) => active && setLoaded({ attempt, preview }));
    return () => {
      active = false;
    };
  }, [change, enrollment.id, attempt]);
  const preview = loaded?.attempt === attempt ? loaded.preview : null;
  const price = preview?.kind === "confirm" && preview.result.status === "ok" ? preview.result.price : null;
  const ready = change === "confirm" ? price?.status === "ok" : preview !== null && preview.kind !== "failed";

  const save = () =>
    startSending(async () => {
      const r = await settle(() =>
        change === "confirm"
          ? confirmAction(enrollment.id, price?.status === "ok" ? price.netPriceCents : -1)
          : change === "drop"
            ? dropAction(enrollment.id, droppedOn)
            : cancelAction(enrollment.id),
      );
      if (!r.ok) {
        setMessage(r.message);
        // The price moved since it was shown (another enrollment of the payer): show the new one.
        if (change === "confirm") setAttempt((n) => n + 1);
        return;
      }
      onClose(true);
      notifications.show({ color: "green", message: DONE[change] });
      router.refresh();
      // The button that opened the dialog may be gone with the change: the section keeps the focus.
      requestAnimationFrame(() => document.getElementById(ENROLLMENTS_HEADING)?.focus());
    });

  const who = enrollment.students;
  const summary = `${enrollment.courses.join(", ") || "sans cours"}, ${formatEuros(enrollment.netPriceCents)}`;
  let body: ReactNode;
  if (preview === null) {
    body = (
      <Group gap="xs" role="status">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Vérification…
        </Text>
      </Group>
    );
  } else if (preview.kind === "failed") {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2">
        <Text size="sm" c="red">
          {NOT_SAVED}
        </Text>
        <Button variant="default" size="xs" onClick={() => setAttempt((n) => n + 1)}>
          Réessayer
        </Button>
      </div>
    );
  } else if (preview.kind === "confirm") {
    const r = preview.result;
    body =
      r.status === "invalid" ? (
        <Text role="alert" size="sm">
          {r.message}
        </Text>
      ) : r.price.status === "error" ? (
        <Text role="alert" size="sm">
          {r.price.error.message}
        </Text>
      ) : (
        <>
          <Text size="sm">{who} passe à « Inscrit » au prix recalculé avec les inscriptions en cours du payeur :</Text>
          <PriceDetail price={r.price} />
          {r.price.netPriceCents !== r.savedNetPriceCents && (
            <Text size="xs" c="dimmed">
              Prix enregistré à l’inscription : {formatEuros(r.savedNetPriceCents)}.
            </Text>
          )}
          <DiscountImpacts impacts={r.existingImpacts} />
        </>
      );
  } else if (change === "drop") {
    body = (
      <>
        <DateField
          label="Date de l’abandon"
          required
          minDate={bounds.min}
          maxDate={bounds.max}
          value={droppedOn}
          onChange={setDroppedOn}
          w={160}
        />
        <Text size="sm">
          {who} n’apparaîtra plus sur les appels des séances après cette date. Le prix de l’inscription (
          {formatEuros(enrollment.netPriceCents)}) reste dû ; un avoir éventuel se décide à part.
        </Text>
        <DiscountImpacts impacts={preview.impacts} />
      </>
    );
  } else {
    body = (
      <>
        <Text size="sm">
          L’inscription {ofName(who)} ({summary}) sera supprimée, comme si elle n’avait pas été saisie. Les paiements
          déjà reçus ne changent pas : ils restent sur le solde du payeur.
        </Text>
        <DiscountImpacts impacts={preview.impacts} />
      </>
    );
  }

  return (
    <Modal opened onClose={() => onClose(false)} title={TITLES[change]} centered>
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (refusedDateField(e.currentTarget) || !ready || sending) return;
          save();
        }}
      >
        {body}
        {message && (
          <Text role="alert" size="sm" c="red">
            {message}
          </Text>
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={() => onClose(false)} data-autofocus>
            {change === "cancel" ? "Garder l’inscription" : "Fermer"}
          </Button>
          <Button type="submit" color={change === "cancel" ? "red" : undefined} disabled={!ready} loading={sending}>
            {TITLES[change]}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}

type Preview =
  | { kind: "confirm"; result: ConfirmationPreview }
  | { kind: "leaving"; impacts: ExistingImpact[] }
  | { kind: "failed" };

/** What the change would do, read from the server; a lost connection is told, not thrown. */
async function loadPreview(change: Change, id: string): Promise<Preview> {
  try {
    return change === "confirm"
      ? { kind: "confirm", result: await confirmationPreviewAction(id) }
      : { kind: "leaving", impacts: await leavingImpactsAction(id) };
  } catch {
    return { kind: "failed" };
  }
}
