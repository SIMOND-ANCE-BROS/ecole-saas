"use client";

import { Button } from "@mantine/core";

export function PrintButton() {
  return (
    <Button variant="default" onClick={() => window.print()}>
      Imprimer la liste
    </Button>
  );
}
