import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption of secrets stored in the database (calendar tokens, invoicing
 * tool credentials): AES-256-GCM, 32-byte key in base64 in CLE_CHIFFREMENT,
 * never in the repository. Format: v1.<iv>.<tag>.<data>.
 */

function key(): Buffer {
  const raw = Buffer.from(process.env.CLE_CHIFFREMENT ?? "", "base64");
  if (raw.length !== 32) throw new Error("CLE_CHIFFREMENT absente ou invalide : 32 octets en base64 attendus");
  return raw;
}

export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const encryptor = createCipheriv("aes-256-gcm", key(), iv);
  const parsed = Buffer.concat([encryptor.update(text, "utf8"), encryptor.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    encryptor.getAuthTag().toString("base64url"),
    parsed.toString("base64url"),
  ].join(".");
}

export function decrypt(ciphertext: string): string {
  const [version, iv, tag, parsed] = ciphertext.split(".");
  if (version !== "v1" || !iv || !tag || !parsed) throw new Error("Texte chiffré invalide");
  const decryptor = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decryptor.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decryptor.update(Buffer.from(parsed, "base64url")), decryptor.final()]).toString("utf8");
}
