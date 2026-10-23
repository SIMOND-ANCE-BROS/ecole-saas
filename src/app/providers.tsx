"use client";

import { DatesProvider } from "@mantine/dates";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "dayjs/locale/fr";
import type { ReactNode } from "react";
import { theme } from "./theme";

/**
 * Fournisseurs de l'interface (#107) : Mantine (thème, mode sombre selon le
 * système), dates en français, messages après une action (notifications).
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <DatesProvider settings={{ locale: "fr", firstDayOfWeek: 1 }}>
        <Notifications position="bottom-right" />
        {children}
      </DatesProvider>
    </MantineProvider>
  );
}
