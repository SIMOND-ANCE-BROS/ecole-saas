"use client";

import { Button, Text } from "@mantine/core";
import { useState, useTransition } from "react";
import { becomeStudent } from "../../eleves/actions";

/** A parent who also takes courses: they join the student list. */
export function BecomeStudent({ id, firstName: firstName }: { id: string; firstName: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  return (
    <>
      <Button
        variant="default"
        disabled={inProgress}
        onClick={() => startTransition(async () => setMessage((await becomeStudent(id)).message))}
      >
        {firstName} prend aussi des cours
      </Button>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </>
  );
}
