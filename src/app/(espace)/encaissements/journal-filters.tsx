"use client";

import { Anchor, Button, NativeSelect, Paper } from "@mantine/core";
import { useState } from "react";
import { PAYMENT_METHODS, type Method } from "@/db/payments";
import { DateField, refusedDateField } from "../_ui/date-field";

type Props = { from: string; to: string; method: Method | null; exportUrl: string };

/**
 * Period and method of the payment log (#98), sent in the address
 * (`?du=&au=&moyen=`) like before: the page reads them on the server.
 */
export function JournalFilters({ from: shownFrom, to: shownTo, method, exportUrl }: Props) {
  const [from, setFrom] = useState(shownFrom);
  const [to, setTo] = useState(shownTo);
  return (
    <Paper
      component="form"
      role="search"
      withBorder
      p="sm"
      // Aligned on the top of the fields: a date message does not shift the others.
      className="flex flex-wrap items-start gap-3"
      onSubmit={(e) => {
        if (refusedDateField(e.currentTarget)) e.preventDefault();
      }}
    >
      <input type="hidden" name="vue" value="journal" />
      <DateField label="Du" name="du" w={180} value={from} onChange={setFrom} />
      <DateField label="Au" name="au" w={180} minDate={from || undefined} value={to} onChange={setTo} />
      <NativeSelect
        label="Moyen"
        name="moyen"
        defaultValue={method ?? ""}
        data={[
          { value: "", label: "Tous" },
          ...Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })),
        ]}
      />
      <Button type="submit" variant="default" mt={25}>
        Afficher
      </Button>
      <Anchor href={exportUrl} size="sm" mt={30} className="ml-auto">
        Exporter (CSV)
      </Anchor>
    </Paper>
  );
}
