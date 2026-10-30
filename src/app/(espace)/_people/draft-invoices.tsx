"use client";

import { Button, Loader, Text } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { notSent, settle } from "@/lib/action-result";
import { draftInvoices } from "./invoice-actions";

// Drafting again replaces the unsent drafts in place: retrying never makes a second set.
const FAILED = "Factures non préparées : réessayez. Si le problème continue, vérifiez la connexion.";

const prepared = (n: number) =>
  n === 0
    ? "Rien de nouveau à facturer : tout est déjà sur une facture."
    : `${n} facture${n > 1 ? "s" : ""} préparée${n > 1 ? "s" : ""}.`;

/**
 * « Préparer les factures » (#352): drafts the payer's invoices of the season, one per
 * business; « Mettre à jour les factures » once a draft not sent yet exists, which it replaces.
 */
export function DraftInvoices({ payerId, seasonId, again }: { payerId: string; seasonId: string; again: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      {/* Stays focusable while drafting (aria-disabled, not disabled): focus never falls to the page. */}
      <Button
        size="compact-sm"
        variant="light"
        aria-disabled={busy || undefined}
        rightSection={busy ? <Loader size="xs" /> : null}
        onClick={() => {
          if (busy) return;
          startTransition(async () => {
            const r = await settle(() => draftInvoices({ payerId, seasonId }));
            setMessage(
              r.ok ? { ok: true, text: prepared(r.drafted) } : { ok: false, text: notSent(r) ? FAILED : r.message },
            );
            if (r.ok) router.refresh();
          });
        }}
      >
        {again ? "Mettre à jour les factures" : "Préparer les factures"}
      </Button>
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
