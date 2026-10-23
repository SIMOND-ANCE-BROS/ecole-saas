import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { encrypt, decrypt } from "./chiffrement";

beforeEach(() => {
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
});

describe("chiffrement", () => {
  it("chiffre et déchiffre, avec un résultat différent à chaque fois", () => {
    const a = encrypt("jeton secret é");
    const b = encrypt("jeton secret é");
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret");
    expect(decrypt(a)).toBe("jeton secret é");
  });

  it("refuse un texte altéré ou une autre clé", () => {
    const c = encrypt("jeton");
    const [v, iv, tag, donnees] = c.split(".");
    const tampered = [v, iv, tag, donnees.slice(0, -2) + (donnees.endsWith("A") ? "BB" : "AA")].join(".");
    expect(() => decrypt(tampered)).toThrow();
    process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
    expect(() => decrypt(c)).toThrow();
  });

  it("refuse une clé absente ou de mauvaise taille", () => {
    process.env.CLE_CHIFFREMENT = "";
    expect(() => encrypt("x")).toThrow("CLE_CHIFFREMENT");
    process.env.CLE_CHIFFREMENT = randomBytes(16).toString("base64");
    expect(() => encrypt("x")).toThrow("CLE_CHIFFREMENT");
  });
});
