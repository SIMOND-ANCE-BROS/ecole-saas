"use client";

import { Select, Text } from "@mantine/core";
import { usePathname, useRouter } from "next/navigation";
import type { Season } from "@/db/schedule";
import { seasonParam, withSeason } from "../planning/season-link";

/**
 * Season shown on a student or contact record (#362): its enrollments, invoices and internal
 * rules. The current season keeps the record's usual address; another one adds `?saison=`, so
 * the choice survives a refresh. A banner of the address (`?encaisse=`…) is not carried over.
 */
export function RecordSeason({
  seasons,
  shown,
  current,
  empty = false,
}: {
  seasons: Season[];
  shown: Season;
  current: Season;
  /** No enrollment of the record in the season shown: said here, the section being absent. */
  empty?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  if (seasons.length < 2) return null;
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
      <Select
        label="Saison affichée"
        w={210}
        allowDeselect={false}
        data={seasons.map((s) => ({ value: s.id, label: s.id === current.id ? `${s.label} (en cours)` : s.label }))}
        value={shown.id}
        onChange={(id) => {
          if (!id || id === shown.id) return;
          router.push(withSeason(pathname, seasonParam(id, current.id)));
        }}
      />
      {empty && (
        <Text size="sm" c="dimmed" pb={6}>
          Aucune inscription en {shown.label}.
        </Text>
      )}
    </div>
  );
}
