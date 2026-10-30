import type { Metadata } from "next";
import { withSchool } from "@/db";
import { listTreatments } from "@/db/vat-treatments";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { Treatments } from "./treatments";

export const metadata: Metadata = { title: "TVA" };

/** VAT treatments of the school (#301): how VAT applies to each course and lesson pack. Management only. */
export default async function VatPage() {
  const { schoolId } = await requireRole("director");
  const treatments = await withSchool(schoolId, (tx) => listTreatments(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="TVA"
        help="Comment la TVA s’applique aux cours et aux carnets : exonération, hors champ ou taux de TVA. Les prix de la grille sont TTC : la TVA en est déduite sur les factures. Chaque cours a son traitement, choisi dans sa fiche ; les mentions sont à faire valider par le comptable."
      />
      <Treatments treatments={treatments} />
    </section>
  );
}
