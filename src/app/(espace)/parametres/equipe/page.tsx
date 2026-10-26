import type { Metadata } from "next";
import { withSchool } from "@/db";
import { listMembers, pendingInvitations } from "@/db/team";
import { requireRole } from "@/lib/session";
import { SettingsHeader } from "../settings-header";
import { Team } from "./team";

export const metadata: Metadata = { title: "Équipe" };

/** Who can sign in to the school, and with which role (#104). Management only. */
export default async function TeamPage() {
  const { schoolId: schoolId, userId } = await requireRole("director");
  const now = new Date();
  const { members, invitations } = await withSchool(schoolId, async (tx) => ({
    members: await listMembers(tx),
    invitations: await pendingInvitations(tx, now),
  }));

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <SettingsHeader
        title="Équipe"
        help="Les personnes qui se connectent au logiciel : la direction gère tout, l’accueil inscrit et encaisse."
      />
      <Team
        members={members.map(({ userId: memberUser, ...m }) => ({ ...m, me: memberUser === userId }))}
        invitations={invitations.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))}
      />
    </section>
  );
}
