import type { Metadata } from "next";
import { withSchool } from "@/db";
import { listEntities } from "@/db/billing-entities";
import { sendingProblems } from "@/db/invoice-outbox";
import { treatmentChoices } from "@/db/vat-treatments";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { Entities } from "./entities";
import { SendingProblems } from "./sending-problems";

export const metadata: Metadata = { title: "Entreprises" };

/**
 * Billing entities of the school (#298): who invoices, cashes and deposits; above them, the
 * invoices their tools could not issue (#304). Management only.
 */
export default async function EntitiesPage() {
  const { schoolId } = await requireRole("director");
  const { entities, treatments, problems } = await withSchool(schoolId, async (tx) => ({
    entities: await listEntities(tx),
    treatments: await treatmentChoices(tx),
    problems: await sendingProblems(tx),
  }));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Entreprises"
        help="Les entreprises qui facturent les cours et encaissent les paiements, chacune avec son SIREN, sa TVA et son compte bancaire. L’entreprise par défaut encaisse les paiements saisis à l’accueil."
      />
      <SendingProblems problems={problems} showEntity={entities.length > 1} />
      <Entities entities={entities} treatments={treatments} />
    </section>
  );
}
