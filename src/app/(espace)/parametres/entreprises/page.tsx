import type { Metadata } from "next";
import { withSchool } from "@/db";
import { listEntities } from "@/db/billing-entities";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { Entities } from "./entities";

export const metadata: Metadata = { title: "Entreprises" };

/** Billing entities of the school (#298): who invoices, cashes and deposits. Management only. */
export default async function EntitiesPage() {
  const { schoolId } = await requireRole("director");
  const entities = await withSchool(schoolId, (tx) => listEntities(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Entreprises"
        help="Les entreprises qui facturent les cours et encaissent les paiements, chacune avec son SIREN, sa TVA et son compte bancaire. L’entreprise par défaut encaisse les paiements saisis à l’accueil."
      />
      <Entities entities={entities} />
    </section>
  );
}
