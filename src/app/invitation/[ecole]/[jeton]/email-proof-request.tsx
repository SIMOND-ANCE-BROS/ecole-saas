"use client";

import { Alert, Button } from "@mantine/core";
import { useActionState } from "react";
import type { ProofRequestState } from "./actions";

type Props = {
  action: (s: ProofRequestState) => Promise<ProofRequestState>;
  email: string;
};

/** Asks for the link proving the invited e-mail (#179); says where it went, or why it did not. */
export function EmailProofRequest({ action, email }: Props) {
  const [state, submit, inProgress] = useActionState(action, { error: null, sent: false });
  return (
    <form action={submit} className="flex flex-col gap-4">
      {state.sent && (
        <Alert color="green" title="E-mail envoyé" role="status">
          Ouvrez le lien envoyé à {email} dans l’heure. Rien reçu ? Regardez dans les indésirables.
        </Alert>
      )}
      {state.error && (
        <Alert color="red" role="alert">
          {state.error}
        </Alert>
      )}
      <Button type="submit" loading={inProgress} variant={state.sent ? "default" : "filled"}>
        {state.sent ? "Renvoyer l’e-mail" : "Recevoir le lien par e-mail"}
      </Button>
    </form>
  );
}
