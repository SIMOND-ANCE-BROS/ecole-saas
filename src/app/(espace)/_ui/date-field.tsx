"use client";

import { DateInput, type DateInputProps } from "@mantine/dates";
import { useState } from "react";
import { parseTypedDate } from "@/lib/dates";

type Props = Omit<DateInputProps, "value" | "onChange" | "valueFormat" | "dateParser"> & {
  /** `YYYY-MM-DD`, or "" when empty. */
  value: string;
  onChange: (value: string) => void;
};

/**
 * Date field of the whole interface (#115): typed as « 12/09/2027 » or
 * picked in the calendar, read strictly (`parseTypedDate`). With `name`, the
 * form receives `YYYY-MM-DD`, like the native date field it replaces.
 *
 * Text that is not a date is never silently replaced by the previous date:
 * it stays visible with a message and the value becomes empty, so an old
 * date cannot be saved by mistake. A field that is not `required` can be
 * emptied.
 */
export function DateField({ value, onChange, error, onBlur, onFocus, ...props }: Props) {
  const [unread, setUnread] = useState(false);
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
        setUnread(false);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        const text = e.currentTarget.value.trim();
        const unreadable = text !== "" && parseTypedDate(text) === null;
        setUnread(unreadable);
        if (unreadable) onChange("");
        onBlur?.(e);
      }}
      error={unread ? "Date non reconnue : tapez jj/mm/aaaa" : error}
      {...props}
    />
  );
}
