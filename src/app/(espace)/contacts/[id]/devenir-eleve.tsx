"use client";

import { useState, useTransition } from "react";
import { becomeStudent } from "../../eleves/actions";

/** Un parent qui prend aussi des cours : il rejoint la liste des élèves. */
export function BecomeStudent({ id, firstName: firstName }: { id: string; firstName: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        className="bouton-secondaire"
        disabled={inProgress}
        onClick={() => startTransition(async () => setMessage((await becomeStudent(id)).message))}
      >
        {firstName} prend aussi des cours
      </button>
      {message && (
        <p role="alert" className="text-sm text-erreur">
          {message}
        </p>
      )}
    </>
  );
}
