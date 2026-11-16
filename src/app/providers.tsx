"use client";

import { DatesProvider } from "@mantine/dates";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "dayjs/locale/fr";
import type { ReactNode } from "react";
import { cssVariablesResolver, theme } from "./theme";

/**
 * Interface providers (#107): Mantine (theme, dark mode following the
 * system), dates in French, messages after an action (notifications).
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
      <DatesProvider settings={{ locale: "fr", firstDayOfWeek: 1 }}>
        {/* Mantine 9 pauses every message when one is hovered; keep 8.x: only the hovered one (#129). */}
        <Notifications position="bottom-right" pauseResetOnHover="notification" />
        {children}
      </DatesProvider>
    </MantineProvider>
  );
}
