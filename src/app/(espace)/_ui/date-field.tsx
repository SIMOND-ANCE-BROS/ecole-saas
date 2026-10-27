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
 *
 * Refused text also marks the input (`data-date-refused`): a form calls
 * `refusedDateField()` before saving, so Enter in another field cannot save
 * the form without that date either.
 */
export function DateField({
  value,
  onChange,
  onCommit,
  error,
  onBlur,
  onFocus,
  onClick,
  onInput,
  onKeyDown,
  popoverProps,
  getDayProps,
  minDate,
  maxDate,
  ...props
}: Props) {
  // Why the text in the field is refused, and whether that is shown yet.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  // The calendar is opened here rather than by Mantine, so that a refused
  // save can focus the field without the calendar covering the message.
  const [open, setOpen] = useState(false);
  // Refused text always empties the value: a value given back by the parent
  // (a row removed, another week) replaces the text, and the refusal with it.
  const refused = value === "" ? refusal : null;
  const check = (text: string) => typedDateRefusal(text, minDate ?? null, maxDate ?? null);
  // Enter or blur: show why the text is refused, or hand over the settled date.
  const settle = (text: string) => {
    const why = check(text);
    setRefusal(why);
    setShown(true);
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
      popoverProps={{
        ...popoverProps,
        opened: open,
        onClose: () => {
          setOpen(false);
          popoverProps?.onClose?.();
        },
      }}
      value={value || null}
      onChange={(v) => onChange(v ?? "")}
      onInput={(e) => {
        const text = e.currentTarget.value;
        const why = check(text);
        setRefusal(why);
        setShown(false);
        setOpen(true);
        // Mantine keeps the previous date for text it cannot accept: drop it.
        if (text.trim() === "" || why) onChange("");
        onInput?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
        if (e.key === "Enter" && settle(e.currentTarget.value)) e.preventDefault();
        onKeyDown?.(e);
      }}
      onFocus={(e) => {
        // Focus given by `refusedDateField()`: the message stays visible.
        if (e.currentTarget.dataset.quietFocus) delete e.currentTarget.dataset.quietFocus;
        else setOpen(true);
        onFocus?.(e);
      }}
      onClick={(e) => {
        setOpen(true);
        onClick?.(e);
      }}
      onBlur={(e) => {
        setOpen(false);
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
            setShown(false);
            setOpen(false);
            // A click on the selected day of an optional field empties it.
            if (props.required || day !== value) onCommit?.(day);
          },
        };
      }}
      error={(shown && refused) || error}
      data-date-refused={refused ? true : undefined}
      {...props}
    />
  );
}

/**
 * First date field of the form (or of an edited table row) whose text is
 * refused, focused with its message shown; null when every date can be
 * saved. Forms call it at the start of `onSubmit` and send nothing when it
 * returns a field.
 */
export function refusedDateField(form: HTMLElement): HTMLInputElement | null {
  const field = form.querySelector<HTMLInputElement>("input[data-date-refused]");
  // Its message is already shown: the submit came from Enter in another
  // field or a click on a button, so this field was left (blur) before.
  // Already focused (Enter inside it): no focus event would consume the flag.
  if (field && document.activeElement !== field) {
    field.dataset.quietFocus = "1";
    field.focus();
  }
  return field;
}
