import type { Metadata } from "next";
import { withSchool } from "@/db";
import { listDisciplines } from "@/db/parametres";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../entete";
import { Disciplines } from "./disciplines";

export const metadata: Metadata = { title: "Disciplines" };

export default async function PageDisciplines() {
  const { schoolId: schoolId } = await requireRole("direction");
  const disciplines = await withSchool(schoolId, (tx) => listDisciplines(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Disciplines"
        help="Les disciplines proposées aux cours. Une ligne de la grille tarifaire peut être réservée à une discipline (par exemple « Zumba 2 h »)."
      />
      <Disciplines disciplines={disciplines} />
    </section>
  );
}
