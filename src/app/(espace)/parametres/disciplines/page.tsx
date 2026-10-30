import type { Metadata } from "next";
import { withSchool } from "@/db";
import { listDisciplines } from "@/db/settings";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { Disciplines } from "./disciplines";

export const metadata: Metadata = { title: "Disciplines" };

export default async function PageDisciplines() {
  const { schoolId: schoolId } = await requireRole("director");
  const disciplines = await withSchool(schoolId, (tx) => listDisciplines(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Disciplines"
        help="Les disciplines proposées aux cours. Une ligne de la grille tarifaire peut être réservée à une discipline (par exemple « Zumba 2 h »). Le certificat médical est demandé à tous les élèves mineurs et à tous ceux qui suivent un cours de compétition ; aux adultes, seulement dans les disciplines cochées « Certificat médical exigé des adultes » (décochez par exemple les danses de couple)."
      />
      <Disciplines disciplines={disciplines} />
    </section>
  );
}
