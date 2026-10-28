"use client";

import { Anchor, Button, Paper } from "@mantine/core";
import { useState } from "react";
import { DateField, refusedDateField } from "../_ui/date-field";

type Props = {
  from: string;
  to: string;
  /** Column filters and sort of the table (`f`, `mode`, `sort`, `order`), kept when the period changes. */
  keep: [string, string][];
  exportUrl: string;
};

/**
 * Period of the payment log (#98), sent in the address (`?du=&au=`): the page
 * reads it on the server. The method and the other criteria are the table's
 * column filters (#107).
 */
export function JournalFilters({ from: shownFrom, to: shownTo, keep, exportUrl }: Props) {
  const [from, setFrom] = useState(shownFrom);
  const [to, setTo] = useState(shownTo);
  return (
    <Paper
      component="form"
      role="search"
      aria-label="Période"
      withBorder
      p="sm"
      // Aligned on the top of the fields: a date message does not shift the others.
      className="flex flex-wrap items-start gap-3"
      onSubmit={(e) => {
        if (refusedDateField(e.currentTarget)) e.preventDefault();
      }}
    >
      <input type="hidden" name="vue" value="journal" />
      {keep.map(([name, value], i) => (
        <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
      ))}
      <DateField label="Du" name="du" w={180} value={from} onChange={setFrom} />
      <DateField label="Au" name="au" w={180} minDate={from || undefined} value={to} onChange={setTo} />
      <Button type="submit" variant="default" mt={25}>
        Afficher
      </Button>
      <Anchor href={exportUrl} size="sm" mt={30} className="ml-auto">
        Exporter (CSV)
      </Anchor>
    </Paper>
  );
}
