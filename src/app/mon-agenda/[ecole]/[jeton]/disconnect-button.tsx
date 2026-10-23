"use client";

import { useState, useTransition } from "react";
import { disconnectMyCalendar } from "./actions";

export function DisconnectButton({ schoolId: schoolId, token: token }: { schoolId: string; token: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        className="bouton-secondaire self-start"
        disabled={inProgress}
        onClick={() => startTransition(async () => setMessage((await disconnectMyCalendar(schoolId, token)).message))}
      >
        Déconnecter mon agenda
      </button>
      {message && (
        <p role="alert" className="text-erreur">
          {message}
        </p>
      )}
    </>
  );
}
