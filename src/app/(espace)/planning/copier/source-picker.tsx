"use client";

import { Select } from "@mantine/core";
import { useRouter } from "next/navigation";
import type { Season } from "@/db/schedule";
import { withSeason } from "../season-link";

/** Season whose planning is copied (#190); the review below follows the choice. */
export function SourcePicker({
  seasons,
  chosen,
  current,
  target,
}: {
  seasons: Season[];
  chosen: string;
  /** Today's season, marked « (en cours) ». */
  current: string | undefined;
  /** `?saison=` of the season to fill, undefined for the current one. */
  target: string | undefined;
}) {
  const router = useRouter();
  return (
    <Select
      label="Copier le planning de la saison"
      w={260}
      allowDeselect={false}
      data={seasons.map((s) => ({ value: s.id, label: s.id === current ? `${s.label} (en cours)` : s.label }))}
      value={chosen}
      onChange={(id) => {
        if (id && id !== chosen)
          router.replace(withSeason(`/planning/copier?depuis=${encodeURIComponent(id)}`, target));
      }}
    />
  );
}
