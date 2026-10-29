"use client";

import { Button } from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { monthLabel, shiftMonth } from "@/domain/payroll/month";

/**
 * Month of a statement (#285), sent in the address (`?mois=2027-10`): the
 * previous and next months one click (or Tab, Enter) away, any other month
 * from the picker.
 */
export function MonthNav({ base, month }: { base: string; month: string }) {
  const router = useRouter();
  const href = (m: string) => `${base}?mois=${m}`;
  const before = shiftMonth(month, -1);
  const after = shiftMonth(month, 1);
  return (
    <nav aria-label="Mois du relevé" className="flex flex-wrap items-end gap-2">
      <MonthPickerInput
        label="Mois"
        w={190}
        value={`${month}-01`}
        valueFormat="MMMM YYYY"
        onChange={(v) => {
          if (v && v.slice(0, 7) !== month) router.push(href(v.slice(0, 7)));
        }}
      />
      <Button component={Link} href={href(before)} variant="default">
        ‹ {monthLabel(before)}
      </Button>
      <Button component={Link} href={href(after)} variant="default">
        {monthLabel(after)} ›
      </Button>
    </nav>
  );
}
