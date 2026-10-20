import type { Metadata } from "next";
import { avecEcole } from "@/db";
import { listerDisciplines } from "@/db/parametres";
import { exigerRole } from "@/lib/session";
import { EnteteParametres } from "../entete";
import { Disciplines } from "./disciplines";

export const metadata: Metadata = { title: "Disciplines" };

export default async function PageDisciplines() {
  const { ecoleId } = await exigerRole("direction");
  const disciplines = await avecEcole(ecoleId, (tx) => listerDisciplines(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <EnteteParametres
        titre="Disciplines"
        aide="Les disciplines proposées aux cours. Une ligne de la grille tarifaire peut être réservée à une discipline (par exemple « Zumba 2 h »)."
      />
      <Disciplines disciplines={disciplines} />
    </section>
  );
}
