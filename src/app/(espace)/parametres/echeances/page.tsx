import type { Metadata } from "next";
import { withSchool } from "@/db";
import { readInstallmentPlans } from "@/db/installment-plans";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { PlanSettings } from "./plan-settings";

export const metadata: Metadata = { title: "Paiement en plusieurs fois" };

export default async function InstallmentPlansSettingsPage() {
  const { schoolId } = await requireRole("director");
  const setting = await withSchool(schoolId, (tx) => readInstallmentPlans(tx));
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Paiement en plusieurs fois"
        help="En combien de fois une famille peut payer un forfait à l’année, et quand tombent les échéances. Les forfaits au trimestre se paient à chaque trimestre ; les carnets et les cours à l’unité en une fois, le jour où la facture est préparée. Les factures déjà préparées gardent leurs échéances jusqu’à leur mise à jour ; une facture émise ne change plus."
      />
      <PlanSettings setting={{ ...setting, counts: [...setting.counts] }} />
    </section>
  );
}
