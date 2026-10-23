import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement des secrets stockés en base (jetons d'agenda, identifiants des
 * outils de facturation) : AES-256-GCM, clé de 32 octets en base64 dans
 * CLE_CHIFFREMENT, jamais dans le dépôt. Format : v1.<iv>.<tag>.<données>.
 */

function cle(): Buffer {
  const brute = Buffer.from(process.env.CLE_CHIFFREMENT ?? "", "base64");
  if (brute.length !== 32) throw new Error("CLE_CHIFFREMENT absente ou invalide : 32 octets en base64 attendus");
  return brute;
}

export function chiffrer(texte: string): string {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv("aes-256-gcm", cle(), iv);
  const donnees = Buffer.concat([chiffreur.update(texte, "utf8"), chiffreur.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    chiffreur.getAuthTag().toString("base64url"),
    donnees.toString("base64url"),
  ].join(".");
}

export function dechiffrer(chiffre: string): string {
  const [version, iv, tag, donnees] = chiffre.split(".");
  if (version !== "v1" || !iv || !tag || !donnees) throw new Error("Texte chiffré invalide");
  const dechiffreur = createDecipheriv("aes-256-gcm", cle(), Buffer.from(iv, "base64url"));
  dechiffreur.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([dechiffreur.update(Buffer.from(donnees, "base64url")), dechiffreur.final()]).toString("utf8");
}
