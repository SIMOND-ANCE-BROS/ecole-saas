import type { Metadata } from "next";
import { withSchool } from "@/db";
import { readEmailSetting } from "@/db/email-connectors";
import { routeLabel } from "@/domain/email/settings";
import { schoolEmailSender } from "@/lib/email";
import { currentSession, requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { EmailSettings } from "./email-settings";

export const metadata: Metadata = { title: "E-mails" };

/** Which account sends the school's invitations and password links (#105). Management only. */
export default async function EmailSettingsPage() {
  const { schoolId } = await requireRole("director");
  const { user } = await currentSession();
  const setting = await withSchool(schoolId, (tx) => readEmailSetting(tx));
  const { route } = await schoolEmailSender(schoolId);
  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="E-mails"
        help="Les invitations et les liens de mot de passe partent par e-mail. Par défaut, le service d’envoi de l’application les envoie au nom de l’école ; l’école peut aussi utiliser son propre compte Brevo ou Resend, avec sa propre adresse d’expédition."
      />
      <EmailSettings
        setting={setting}
        route={routeLabel(route)}
        routeOk={route.kind !== "broken" && route.kind !== "none"}
        me={user.email}
      />
    </section>
  );
}
