import type { Metadata } from "next";
import { withSchool } from "@/db";
import { readRequirements } from "@/db/student-documents";
import { requireRole } from "@/lib/session";
import { FormPage } from "../../_ui/form-page";
import { SettingsHeader } from "../settings-header";
import { Requirements } from "./requirements";

export const metadata: Metadata = { title: "Documents demandés" };

export default async function DocumentsSettingsPage() {
  const { schoolId } = await requireRole("director");
  const requirements = await withSchool(schoolId, (tx) => readRequirements(tx));
  return (
    <FormPage className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Documents demandés"
        help="Les papiers à rendre par les élèves inscrits cette saison, et dans quel délai après l’inscription. Un document à fournir s’affiche sur la fiche de l’élève ; une fois le délai passé, il apparaît aussi dans la liste « Élèves » (colonne « Documents manquants »). L’inscription n’est jamais bloquée."
      />
      <Requirements requirements={requirements} />
    </FormPage>
  );
}
