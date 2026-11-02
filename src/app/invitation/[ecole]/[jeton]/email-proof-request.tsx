"use client";

import { Alert, Button, Text } from "@mantine/core";
import { useActionState } from "react";
import { EMAIL_PROOF_DURATION_TEXT } from "@/domain/team/email-proof";
import type { ProofRequestState } from "./actions";

type Props = {
  action: (s: ProofRequestState) => Promise<ProofRequestState>;
  email: string;
};

/** Asks for the link proving the invited e-mail (#179); says where it went, or why it did not. */
export function EmailProofRequest({ action, email }: Props) {
  const [state, submit, inProgress] = useActionState(action, { error: null, notice: null, sent: false });
  return (
    <form action={submit} className="flex flex-col gap-4">
      {state.sent && (
        // No coloured title: the light green text is below AA contrast; the body text is not.
        <Alert color="green" role="status">
          <Text size="sm" fw={600}>
            E-mail envoyé.
          </Text>
          <Text size="sm">
            Ouvrez le lien envoyé à <span className="whitespace-nowrap">{email}</span> {EMAIL_PROOF_DURATION_TEXT} :
            seul le dernier lien reçu fonctionne. Rien reçu ? Regardez dans les indésirables.
          </Text>
        </Alert>
      )}
      {state.notice && (
        <Alert color="yellow" role="status">
          {state.notice}
        </Alert>
      )}
      {state.error && (
        <Alert color="red" role="alert">
          {state.error}
        </Alert>
      )}
      {/* The page's only action: focused so Enter sends it. */}
      <Button type="submit" loading={inProgress} variant={state.sent ? "default" : "filled"} autoFocus>
        {state.sent ? "Renvoyer l’e-mail" : "Recevoir le lien par e-mail"}
      </Button>
    </form>
  );
}
