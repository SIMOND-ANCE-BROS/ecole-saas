import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { API_KEY_MAX, EMAIL_PROVIDER_VALUES, type EmailProvider, FROM_NAME_MAX } from "../domain/email/settings";
import { encrypt } from "../lib/encryption";
import type { Tx } from "./index";
import { auditLog, emailConnector, member } from "./schema";

/**
 * A school's own e-mail sending account (#105, ADR 0009), a management
 * setting. The API key is encrypted before it reaches the database and never
 * read back to a screen or the audit log (which records whether it changed).
 * Always within the `withSchool()` transaction (RLS): a school reads and uses
 * its own row only.
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
export type Result = { ok: true } | { ok: false; message: string };

/** The setting as a screen sees it: everything but the key. */
export type EmailSetting = { provider: EmailProvider; fromAddress: string; fromName: string; active: boolean };

export async function readEmailSetting(tx: Tx): Promise<EmailSetting | null> {
  const [row] = await tx
    .select({
      provider: emailConnector.provider,
      fromAddress: emailConnector.fromAddress,
      fromName: emailConnector.fromName,
      active: emailConnector.active,
    })
    .from(emailConnector);
  return row ?? null;
}

/** The school's active connector with its encrypted key, to build its sender (server side only). */
export async function readActiveEmailConnector(
  tx: Tx,
): Promise<{ provider: EmailProvider; encryptedApiKey: string; fromAddress: string; fromName: string } | null> {
  const [row] = await tx
    .select({
      provider: emailConnector.provider,
      encryptedApiKey: emailConnector.encryptedApiKey,
      fromAddress: emailConnector.fromAddress,
      fromName: emailConnector.fromName,
    })
    .from(emailConnector)
    .where(eq(emailConnector.active, true));
  return row ?? null;
}

const singleLine = (label: string, max: number) =>
  z
    .string({ error: `${label} obligatoire.` })
    .trim()
    .min(1, `${label} obligatoire.`)
    .max(max, `${label} : ${max} caractères au plus.`)
    .refine((v) => !/[\r\n]/.test(v), `${label} : une seule ligne.`);

export const validEmailSetting = z.object(
  {
    provider: z.enum(EMAIL_PROVIDER_VALUES, { error: "Choisissez un service d’envoi." }),
    fromAddress: z
      .email("Adresse d’expédition invalide.")
      .trim()
      .toLowerCase()
      .max(254, "Adresse d’expédition trop longue."),
    fromName: singleLine("Nom de l’expéditeur", FROM_NAME_MAX),
    /** Empty: keep the saved key (same provider only). */
    apiKey: z
      .string({ error: "Saisie invalide." })
      .trim()
      .max(API_KEY_MAX, "Clé d’API trop longue.")
      .refine((v) => !/\s/.test(v), "La clé d’API ne contient pas d’espace."),
    active: z.boolean({ error: "Saisie invalide." }),
  },
  { error: "Saisie invalide." },
);
export type EmailSettingEntry = z.input<typeof validEmailSetting>;

async function actorOf(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx.select({ id: member.id }).from(member).where(eq(member.userId, userId));
  return m?.id ?? null;
}

/**
 * Saves the school's provider account. A new key is required for a first
 * setting or a change of provider (a Brevo key does not work at Resend).
 * Written to the audit log without the key: only whether it changed.
 */
export async function saveEmailSetting(tx: Tx, userId: string, entry: EmailSettingEntry): Promise<Result> {
  const r = validEmailSetting.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Saisie invalide." };
  const next = r.data;
  // Two saves of the school run one after the other: the second compares with what the first saved.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('email_connector'), hashtext(${CURRENT_SCHOOL}::text))`);
  const before = await readEmailSetting(tx);
  const keyChanged = next.apiKey !== "";
  if (!keyChanged && (!before || before.provider !== next.provider))
    return { ok: false, message: "Saisissez la clé d’API du compte." };
  const fields = {
    provider: next.provider,
    fromAddress: next.fromAddress,
    fromName: next.fromName,
    active: next.active,
  };
  if (keyChanged) {
    const encryptedApiKey = encrypt(next.apiKey);
    await tx
      .insert(emailConnector)
      .values({
        schoolId: CURRENT_SCHOOL,
        provider: next.provider,
        encryptedApiKey,
        fromAddress: next.fromAddress,
        fromName: next.fromName,
        active: next.active,
      })
      .onConflictDoUpdate({
        target: emailConnector.schoolId,
        set: {
          provider: next.provider,
          encryptedApiKey,
          fromAddress: next.fromAddress,
          fromName: next.fromName,
          active: next.active,
          updatedAt: sql`now()`,
        },
      });
  } else {
    await tx
      .update(emailConnector)
      .set({
        provider: next.provider,
        fromAddress: next.fromAddress,
        fromName: next.fromName,
        active: next.active,
        updatedAt: sql`now()`,
      })
      .where(eq(emailConnector.schoolId, CURRENT_SCHOOL));
  }
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "email_connector",
    rowId: CURRENT_SCHOOL,
    action: before ? "update" : "insert",
    before,
    after: { ...fields, api_key_changed: keyChanged },
  });
  return { ok: true };
}

/** Removes the school's account: the application sender takes over. Audited, without the key. */
export async function deleteEmailSetting(tx: Tx, userId: string): Promise<Result> {
  const removed = await tx.delete(emailConnector).where(eq(emailConnector.schoolId, CURRENT_SCHOOL)).returning({
    provider: emailConnector.provider,
    fromAddress: emailConnector.fromAddress,
    fromName: emailConnector.fromName,
    active: emailConnector.active,
  });
  if (removed.length === 0) return { ok: false, message: "Aucun compte d’envoi n’est enregistré." };
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "email_connector",
    rowId: CURRENT_SCHOOL,
    action: "delete",
    before: removed[0],
    after: null,
  });
  return { ok: true };
}
