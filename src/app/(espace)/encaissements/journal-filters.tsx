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
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        if (refusedDateField(e.currentTarget)) e.preventDefault();
      }}
    >
      <input type="hidden" name="vue" value="journal" />
      <DateField label="Du" name="du" w={150} value={from} onChange={setFrom} />
      <DateField label="Au" name="au" w={150} value={to} onChange={setTo} />
      <NativeSelect
        label="Moyen"
        name="moyen"
        defaultValue={method ?? ""}
        data={[
          { value: "", label: "Tous" },
          ...Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })),
        ]}
      />
      <Button type="submit" variant="default">
        Afficher
      </Button>
      <Anchor href={exportUrl} size="sm" className="ml-auto pb-2">
        Exporter (CSV)
      </Anchor>
    </Paper>
  );
}
