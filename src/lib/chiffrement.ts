import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement des secrets stockés en base (jetons d'agenda, identifiants des
 * outils de facturation) : AES-256-GCM, clé de 32 octets en base64 dans
 * CLE_CHIFFREMENT, jamais dans le dépôt. Format : v1.<iv>.<tag>.<données>.
 */

function key(): Buffer {
  const raw = Buffer.from(process.env.CLE_CHIFFREMENT ?? "", "base64");
  if (raw.length !== 32) throw new Error("CLE_CHIFFREMENT absente ou invalide : 32 octets en base64 attendus");
  return raw;
}

export function encrypt(texte: string): string {
  const iv = randomBytes(12);
  const encryptor = createCipheriv("aes-256-gcm", key(), iv);
  const donnees = Buffer.concat([encryptor.update(texte, "utf8"), encryptor.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    encryptor.getAuthTag().toString("base64url"),
    donnees.toString("base64url"),
  ].join(".");
}

export function decrypt(ciphertext: string): string {
  const [version, iv, tag, donnees] = ciphertext.split(".");
  if (version !== "v1" || !iv || !tag || !donnees) throw new Error("Texte chiffré invalide");
  const decryptor = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decryptor.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decryptor.update(Buffer.from(donnees, "base64url")), decryptor.final()]).toString("utf8");
}
