import type { Metadata } from "next";
import { withSchool } from "@/db";
import { listEntities } from "@/db/billing-entities";
import { sendingProblems } from "@/db/invoice-outbox";
import { treatmentChoices } from "@/db/vat-treatments";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { Entities } from "./entities";
import { SendingProblems } from "./sending-problems";
import { TAKEN_UP } from "./taken-up";
import { Banner } from "../../_people/sections";
import { isKeyOf } from "@/lib/has";

export const metadata: Metadata = { title: "Entreprises" };

/**
 * Billing entities of the school (#298): who invoices, cashes and deposits; above them, the
 * invoices their tools could not issue (#304). Management only.
 */
export default async function EntitiesPage({ searchParams }: PageProps<"/parametres/entreprises">) {
  const { schoolId } = await requireRole("director");
  const { reprise } = await searchParams;
  const takenUp = typeof reprise === "string" && isKeyOf(TAKEN_UP, reprise) ? TAKEN_UP[reprise] : undefined;
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
      <Banner text={takenUp} />
      <SendingProblems problems={problems} showEntity={entities.length > 1} />
      <Entities entities={entities} treatments={treatments} />
    </section>
  );
}
