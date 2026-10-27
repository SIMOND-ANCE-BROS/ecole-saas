"use client";

import { DateInput, type DateInputProps } from "@mantine/dates";
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
 */
export function DateField({ value, onChange, ...props }: Props) {
  return (
    <DateInput
      valueFormat="DD/MM/YYYY"
      placeholder="jj/mm/aaaa"
      dateParser={parseTypedDate}
      value={value || null}
      onChange={(v) => onChange(v ?? "")}
      {...props}
    />
  );
}
