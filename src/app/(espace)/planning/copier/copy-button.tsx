"use client";

import { Alert, Button, Group } from "@mantine/core";
import { type ReactNode, useState, useTransition } from "react";
import { copyPlanning } from "./actions";

/** Confirms the copy reviewed above; on success the planning of the filled season opens. */
export function CopyButton({
  sourceId,
  targetId,
  count,
  children,
}: {
  sourceId: string;
  targetId: string;
  count: number;
  /** Next to the button: « Annuler ». */
  children: ReactNode;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-start gap-3">
      {refusal && (
        <Alert color="red" role="alert">
          {refusal}
        </Alert>
      )}
      <Group gap="sm">
        <Button
          loading={inProgress}
          onClick={() =>
            startTransition(async () => {
              setRefusal(null);
              setRefusal((await copyPlanning(sourceId, targetId)).message);
            })
          }
        >
          Copier {count} cours
        </Button>
        {children}
      </Group>
    </div>
  );
}
