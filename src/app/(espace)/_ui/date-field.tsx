"use client";

import { DateInput, type DateInputProps } from "@mantine/dates";
import { useState } from "react";
import { parseTypedDate, typedDateRefusal } from "@/lib/dates";

type Props = Omit<DateInputProps, "value" | "onChange" | "valueFormat" | "dateParser" | "minDate" | "maxDate"> & {
  /** `YYYY-MM-DD`, or "" when empty. */
  value: string;
  onChange: (value: string) => void;
  /** Inclusive bounds, `YYYY-MM-DD`. */
  minDate?: string;
  maxDate?: string;
  /**
   * A date the user has settled on: Enter or leaving the field with an
   * acceptable date, or a day picked in the calendar. Never called for a
   * half-typed date (« 12/09/20 » on the way to 2027).
   */
  onCommit?: (value: string) => void;
};

/**
 * Date field of the whole interface (#115): typed as « 12/09/2027 » or
 * picked in the calendar, read strictly (`parseTypedDate`). With `name`, the
 * form receives `YYYY-MM-DD`, like the native date field it replaces.
 *
 * Text that is not a date, or a date outside `minDate`/`maxDate` (which
 * Mantine ignores without a word), never leaves the previous date behind:
 * the value becomes empty as soon as such text is typed, so Enter cannot
 * save an old date. The message shows on Enter or when leaving the field,
 * not while typing. A field that is not `required` can be emptied.
 */
export function DateField({
  value,
  onChange,
  onCommit,
  error,
  onBlur,
  onFocus,
  onInput,
  onKeyDown,
  getDayProps,
  minDate,
  maxDate,
  ...props
}: Props) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const check = (text: string) => typedDateRefusal(text, minDate ?? null, maxDate ?? null);
  // Enter or blur: show why the text is refused, or hand over the settled date.
  const settle = (text: string) => {
    const why = check(text);
    setRefusal(why);
    const date = why ? null : parseTypedDate(text);
    if (date) onCommit?.(date);
    return why;
  };
  return (
    <DateInput
      valueFormat="DD/MM/YYYY"
      placeholder="jj/mm/aaaa"
      dateParser={parseTypedDate}
      allowDeselect={!props.required}
      // Saturday is a dance day like any other: no red weekend (red is for errors).
      weekendDays={[]}
      fixOnBlur={false}
      minDate={minDate}
      maxDate={maxDate}
      value={value || null}
      onChange={(v) => onChange(v ?? "")}
      onInput={(e) => {
        const text = e.currentTarget.value;
        // Mantine keeps the previous date for text it cannot accept: drop it.
        if (text.trim() === "" || check(text)) onChange("");
        onInput?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && settle(e.currentTarget.value)) e.preventDefault();
        onKeyDown?.(e);
      }}
      onFocus={(e) => {
        setRefusal(null);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        settle(e.currentTarget.value);
        onBlur?.(e);
      }}
      getDayProps={(day) => {
        const given = getDayProps?.(day);
        return {
          ...given,
          onClick: (event) => {
            given?.onClick?.(event);
            setRefusal(null);
            // A click on the selected day of an optional field empties it.
            if (props.required || day !== value) onCommit?.(day);
          },
        };
      }}
      error={refusal ?? error}
      {...props}
    />
  );
}
