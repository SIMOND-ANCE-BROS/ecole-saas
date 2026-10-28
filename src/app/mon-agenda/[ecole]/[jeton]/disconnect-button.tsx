"use client";

import { Button, Text } from "@mantine/core";
import { useState, useTransition } from "react";
import { disconnectMyCalendar } from "./actions";

export function DisconnectButton({ schoolId: schoolId, token: token }: { schoolId: string; token: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  return (
    <>
      <Button
        variant="default"
        className="self-start"
        disabled={inProgress}
        onClick={() => startTransition(async () => setMessage((await disconnectMyCalendar(schoolId, token)).message))}
      >
        Déconnecter mon agenda
      </Button>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </>
  );
}
