"use client";

import { Button, Group, Loader, Modal, Text } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { notSent, settle } from "@/lib/action-result";
import { abandon, sendAgain } from "./actions";

const FAILED = "Non enregistré : réessayez. Si le problème continue, vérifiez la connexion.";

/**
 * What management does with a rejected invoice (#352): « Envoyer à nouveau » (in the tool when
 * it holds a draft of it, otherwise drafted again from the payer's lines), or « Abandonner »,
 * which gives its lines back to the payer's next drafting. Abandoning asks first; for an
 * invoice the tool holds a draft of, its draft must be deleted in the tool beforehand.
 */
export function ProblemActions({ invoiceId, inTool, payer }: { invoiceId: string; inTool: boolean; payer: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const run = (call: () => ReturnType<typeof sendAgain>) =>
    startTransition(async () => {
      const r = await settle(call);
      if (!r.ok) {
        setMessage(notSent(r) ? FAILED : r.message);
        return;
      }
      setMessage(null);
      // The row leaves the list with the refresh.
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-1">
      <Modal opened={asking} onClose={() => setAsking(false)} title="Abandonner cette facture ?" centered>
        <div className="flex flex-col gap-2">
          {inTool && (
            <Text size="sm" fw={500}>
              Supprimez d’abord son brouillon dans l’outil de facturation : il ne doit jamais être émis.
            </Text>
          )}
          <Text size="sm">
            Elle quitte la liste. Ce qu’elle facturait à {payer} reviendra dans la prochaine facture préparée depuis sa
            fiche.
          </Text>
        </div>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setAsking(false)} data-autofocus>
            Garder
          </Button>
          <Button
            color="red"
            onClick={() => {
              setAsking(false);
              run(() => abandon(invoiceId));
            }}
          >
            Abandonner la facture
          </Button>
        </Group>
      </Modal>
      <Group gap="xs">
        <Button
          size="compact-sm"
          variant="light"
          aria-disabled={busy || undefined}
          rightSection={busy ? <Loader size="xs" /> : null}
          onClick={() => !busy && run(() => sendAgain(invoiceId))}
        >
          Envoyer à nouveau
        </Button>
        <Button
          size="compact-sm"
          variant="subtle"
          color="red"
          aria-disabled={busy || undefined}
          onClick={() => !busy && setAsking(true)}
        >
          Abandonner
        </Button>
      </Group>
      {message && (
        <Text role="alert" size="xs" c="red">
          {message}
        </Text>
      )}
    </div>
  );
}
