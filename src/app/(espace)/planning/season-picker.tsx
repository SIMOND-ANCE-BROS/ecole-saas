"use client";

import { Select } from "@mantine/core";
import { useRouter } from "next/navigation";
import type { Season } from "@/db/schedule";
import { withSeason } from "./season-link";

/** Parameters kept when changing season: the view and the « Par salle » day, not the week. */
const KEPT = ["vue", "jour"] as const;

/**
 * Season shown on the planning (#189). The current season keeps the usual
 * address; another one adds `?saison=`. The live view and day are read from
 * the address, which the grid updates without a navigation.
 */
export function SeasonPicker({ seasons, chosen, current }: { seasons: Season[]; chosen: string; current: string }) {
  const router = useRouter();
  return (
    <Select
      label="Saison"
      w={190}
      allowDeselect={false}
      data={seasons.map((s) => ({ value: s.id, label: s.id === current ? `${s.label} (en cours)` : s.label }))}
      value={chosen}
      onChange={(id) => {
        if (!id || id === chosen) return;
        const now = new URLSearchParams(window.location.search);
        const kept = new URLSearchParams();
        for (const k of KEPT) {
          const v = now.get(k);
          if (v) kept.set(k, v);
        }
        const base = kept.size ? `/planning?${kept}` : "/planning";
        router.push(withSeason(base, id === current ? undefined : id));
      }}
    />
  );
}
