import type { Metadata } from "next";
import { avecEcole } from "@/db";
import { listerLieux } from "@/db/parametres";
import { exigerRole } from "@/lib/session";
import { EnteteParametres } from "../entete";
import { Lieux } from "./lieux";

export const metadata: Metadata = { title: "Sites et salles" };

export default async function PageLieux() {
  const { ecoleId } = await exigerRole("direction");
  const lieux = await avecEcole(ecoleId, (tx) => listerLieux(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <EnteteParametres titre="Sites et salles" aide="Les lieux de cours. La capacité d’une salle est proposée par défaut pour les cours qui s’y tiennent ; les horaires d’ouverture d’un site limitent l’agenda du planning." />
      <Lieux lieux={lieux} />
    </section>
  );
}
