import { eq } from "drizzle-orm";
import type { HttpOptions } from "../connectors/email/http";
import { providerSender } from "../connectors/email/providers";
import { type EmailSender, fakeSender, platformEmailSender } from "../connectors/email/sender";
import { withSchool } from "../db";
import { readActiveEmailConnector } from "../db/email-connectors";
import { school } from "../db/schema";
import type { EmailRoute } from "../domain/email/settings";
import { decrypt } from "./encryption";

/**
 * The sender of one school's invitations and password links (#105, ADR 0009):
 * its own active provider account, else the application sender on its behalf
 * (« École X via … »), else the fake sender where allowed, else none. A school
 * account that cannot be used (key unreadable on this server) is reported as
 * `broken` and sends nothing: never a silent fall back to another sender and
 * domain than the one the school chose.
 *
 * Read inside `withSchool(schoolId)`: a school can only ever build its own
 * sender. The decrypted key stays inside the provider's client.
 *
 * Never for proof-of-address e-mails (#179): those always go through
 * `platformEmailSender()`, whose logs no school can read.
 */
export type SchoolSender = { route: EmailRoute; sender: EmailSender | null };

export async function schoolEmailSender(
  schoolId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  options?: HttpOptions,
): Promise<SchoolSender> {
  const { connector, schoolName } = await withSchool(schoolId, async (tx) => ({
    connector: await readActiveEmailConnector(tx),
    schoolName: (await tx.select({ name: school.name }).from(school).where(eq(school.id, schoolId)))[0]?.name,
  }));
  if (connector) {
    let apiKey: string;
    try {
      apiKey = decrypt(connector.encryptedApiKey);
    } catch {
      // Missing or changed CLE_CHIFFREMENT, or a damaged value: the school must save its key again.
      return { route: { kind: "broken", provider: connector.provider }, sender: null };
    }
    const sender = providerSender(
      connector.provider,
      { apiKey, fromAddress: connector.fromAddress, fromName: connector.fromName },
      options,
    );
    return { route: { kind: "school", provider: connector.provider }, sender };
  }
  const sender = platformEmailSender(env, schoolName);
  if (!sender) return { route: { kind: "none" }, sender: null };
  return { route: sender === fakeSender ? { kind: "fake" } : { kind: "platform" }, sender };
}
