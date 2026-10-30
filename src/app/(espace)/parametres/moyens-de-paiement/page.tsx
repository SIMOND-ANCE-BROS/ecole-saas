import type { Metadata } from "next";
import { withSchool } from "@/db";
import { readMethodSettings } from "@/db/payment-methods";
import { requireRole } from "@/lib/session";
import { FormPage } from "../../_ui/form-page";
import { SettingsHeader } from "../settings-header";
import { MethodSettings } from "./method-settings";

export const metadata: Metadata = { title: "Moyens de paiement" };

export default async function PaymentMethodsSettingsPage() {
  const { schoolId } = await requireRole("director");
  const settings = await withSchool(schoolId, (tx) => readMethodSettings(tx));
  return (
    <FormPage className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Moyens de paiement"
        help="Les moyens de paiement que l’école accepte : seuls ceux-ci sont proposés pour encaisser. Les paiements déjà enregistrés gardent leur moyen, même s’il n’est plus accepté."
      />
      <MethodSettings settings={settings} />
    </FormPage>
  );
}
