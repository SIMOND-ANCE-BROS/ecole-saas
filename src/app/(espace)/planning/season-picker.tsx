"use client";

import { Select } from "@mantine/core";
import { useRouter } from "next/navigation";
import type { Season } from "@/db/schedule";
import { withSeason } from "./season-link";

/**
 * Season shown on the planning (#189). The current season keeps the usual
 * address; another one adds `?saison=`. The chosen view is kept.
 */
export function SeasonPicker({
  seasons,
  chosen,
  current,
  view,
}: {
  seasons: Season[];
  chosen: string;
  current: string;
  view: string | undefined;
}) {
  const router = useRouter();
  return (
    <Select
      label="Saison"
      w={150}
      allowDeselect={false}
      data={seasons.map((s) => ({ value: s.id, label: s.label }))}
      value={chosen}
      onChange={(id) => {
        if (!id || id === chosen) return;
        router.push(withSeason(view ? `/planning?vue=${view}` : "/planning", id === current ? undefined : id));
      }}
    />
  );
}
