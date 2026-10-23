import type { Metadata } from "next";
import { withSchool } from "@/db";
import { listPlaces } from "@/db/settings";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { Places } from "./places";

export const metadata: Metadata = { title: "Sites et salles" };

export default async function PlacesPage() {
  const { schoolId: schoolId } = await requireRole("direction");
  const seats = await withSchool(schoolId, (tx) => listPlaces(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Sites et salles"
        help="Les lieux de cours. La capacité d’une salle est proposée par défaut pour les cours qui s’y tiennent ; les horaires d’ouverture d’un site limitent l’agenda du planning."
      />
      <Places seats={seats} />
    </section>
  );
}
