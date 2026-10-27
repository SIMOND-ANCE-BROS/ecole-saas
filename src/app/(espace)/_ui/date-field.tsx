"use client";

import { DateInput, type DateInputProps } from "@mantine/dates";
import { useState } from "react";
import { parseTypedDate, typedDateRefusal } from "@/lib/dates";

type Props = Omit<DateInputProps, "value" | "onChange" | "valueFormat" | "dateParser"> & {
  /** `YYYY-MM-DD`, or "" when empty. */
  value: string;
  onChange: (value: string) => void;
};

const iso = (d: DateInputProps["minDate"]) =>
  d === undefined ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/**
 * Date field of the whole interface (#115): typed as « 12/09/2027 » or
 * picked in the calendar, read strictly (`parseTypedDate`). With `name`, the
 * form receives `YYYY-MM-DD`, like the native date field it replaces.
 *
 * Text that is not a date, or a date outside `minDate`/`maxDate` (which
 * Mantine ignores without a word), is never silently replaced by the
 * previous date: it stays visible with a message and the value becomes
 * empty, so an old date cannot be saved by mistake. A field that is not
 * `required` can be emptied.
 */
export function DateField({ value, onChange, error, onBlur, onFocus, ...props }: Props) {
  const [unread, setUnread] = useState<string | null>(null);
  const min = iso(props.minDate);
  const max = iso(props.maxDate);
  return (
    <DateInput
      valueFormat="DD/MM/YYYY"
      placeholder="jj/mm/aaaa"
      dateParser={parseTypedDate}
      allowDeselect={!props.required}
      // Saturday is a dance day like any other: no red weekend (red is for errors).
      weekendDays={[]}
      fixOnBlur={false}
      value={value || null}
      onChange={(v) => onChange(v ?? "")}
      onFocus={(e) => {
        setUnread(null);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        const why = typedDateRefusal(e.currentTarget.value, min, max);
        setUnread(why);
        if (why) onChange("");
        onBlur?.(e);
      }}
      error={unread ?? error}
      {...props}
    />
  );
}
