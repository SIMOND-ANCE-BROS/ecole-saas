import type { Metadata } from "next";
import { avecEcole } from "@/db";
import { listerSaisons } from "@/db/parametres";
import { exigerRole } from "@/lib/session";
import { EnteteParametres } from "../entete";
import { Saisons } from "./saisons";

export const metadata: Metadata = { title: "Saisons" };

export default async function PageSaisons() {
  const { ecoleId } = await exigerRole("direction");
  const saisons = await avecEcole(ecoleId, (tx) => listerSaisons(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <EnteteParametres titre="Saisons" aide="La saison courante est celle qui contient la date du jour. Une nouvelle saison peut reprendre la grille tarifaire, les réductions et les carnets d’une autre." />
      <Saisons saisons={saisons} />
    </section>
  );
}
