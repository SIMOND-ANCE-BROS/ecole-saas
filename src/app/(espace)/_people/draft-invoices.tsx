"use client";

import { Button, Loader, Text } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { notSent, settle } from "@/lib/action-result";
import { planLabel } from "@/domain/invoicing/plans";
import { draftInvoices } from "./invoice-actions";

// Drafting again replaces the unsent drafts in place: retrying never makes a second set.
const FAILED = "Factures non préparées : réessayez. Si le problème continue, vérifiez la connexion.";

/** `again`: drafts not sent yet existed, and were replaced; `count`: the plan clicked. */
const prepared = (n: number, again: boolean, count: number | undefined) => {
  if (n === 0) return "Rien de nouveau à facturer : tout est déjà sur une facture.";
  const done = again ? "Factures mises à jour" : `${n} facture${n > 1 ? "s" : ""} préparée${n > 1 ? "s" : ""}`;
  return count === undefined ? `${done}.` : `${done} : ${planLabel(count)}.`;
};

/** « En une fois », « En 3 fois »: a plan's button. */
const planButton = (count: number) => planLabel(count).replace(/^en/, "En");

/**
 * « Préparer les factures » (#352): drafts the payer's invoices of the season, one per
 * business, in one click per plan the school offers and the season still fits (#176):
 * « En une fois », « En 3 fois »… The plan of the drafts not sent yet is ticked; clicking
 * another drafts them again with it. With no plan left that fits, one button keeps each
 * business's previous plan.
 */
export function DraftInvoices({
  payerId,
  seasonId,
  again,
  counts,
  current,
}: {
  payerId: string;
  seasonId: string;
  again: boolean;
  /** The plans that fit (`plansThatFit`). */
  counts: readonly number[];
  /** The plan of the unsent drafts; null: none chosen. */
  current: number | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<number | "keep" | null>(null);
  const [, startTransition] = useTransition();
  const draft = (installmentCount: number | undefined) => {
    if (busy !== null) return;
    setBusy(installmentCount ?? "keep");
    startTransition(async () => {
      const r = await settle(() => draftInvoices({ payerId, seasonId, installmentCount }));
      setMessage(
        r.ok
          ? { ok: true, text: prepared(r.drafted, again, installmentCount) }
          : { ok: false, text: notSent(r) ? FAILED : r.message },
      );
      setBusy(null);
      if (r.ok) router.refresh();
    });
  };
  const title = again ? "Mettre à jour les factures" : "Préparer les factures";
  return (
    <div className="flex flex-col items-end gap-1">
      {counts.length === 0 ? (
        <Button
          size="compact-sm"
          variant="light"
          aria-disabled={busy !== null || undefined}
          rightSection={busy !== null ? <Loader size="xs" /> : null}
          onClick={() => draft(undefined)}
        >
          {title}
        </Button>
      ) : (
        <div role="group" aria-label={title} className="flex flex-wrap items-center justify-end gap-2">
          <Text aria-hidden size="sm" fw={500}>
            {title}
          </Text>
          {counts.map((c) => (
            // Stays focusable while drafting (aria-disabled, not disabled): focus never falls to the page.
            <Button
              key={c}
              size="compact-sm"
              // Secondary like every plan (one primary button per view); the current one is ticked.
              variant="light"
              aria-pressed={c === current}
              aria-disabled={busy !== null || undefined}
              leftSection={c === current ? <span aria-hidden>✓</span> : null}
              rightSection={busy === c ? <Loader size="xs" color="currentColor" /> : null}
              onClick={() => draft(c)}
            >
              {planButton(c)}
            </Button>
          ))}
        </div>
      )}
      {/* Always present, so screen readers announce the text when it appears. */}
      <Text role="status" size="xs" className={message?.ok ? undefined : "sr-only"}>
        {message?.ok ? message.text : ""}
      </Text>
      {message && !message.ok && (
        <Text role="alert" size="xs" c="red">
          {message.text}
        </Text>
      )}
    </div>
  );
}
