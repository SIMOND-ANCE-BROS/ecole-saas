import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { chiffrer, dechiffrer } from "./chiffrement";

beforeEach(() => {
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
});

describe("chiffrement", () => {
  it("chiffre et déchiffre, avec un résultat différent à chaque fois", () => {
    const a = chiffrer("jeton secret é");
    const b = chiffrer("jeton secret é");
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret");
    expect(dechiffrer(a)).toBe("jeton secret é");
  });

  it("refuse un texte altéré ou une autre clé", () => {
    const c = chiffrer("jeton");
    const [v, iv, tag, donnees] = c.split(".");
    const altere = [v, iv, tag, donnees.slice(0, -2) + (donnees.endsWith("A") ? "BB" : "AA")].join(".");
    expect(() => dechiffrer(altere)).toThrow();
    process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
    expect(() => dechiffrer(c)).toThrow();
  });

  it("refuse une clé absente ou de mauvaise taille", () => {
    process.env.CLE_CHIFFREMENT = "";
    expect(() => chiffrer("x")).toThrow("CLE_CHIFFREMENT");
    process.env.CLE_CHIFFREMENT = randomBytes(16).toString("base64");
    expect(() => chiffrer("x")).toThrow("CLE_CHIFFREMENT");
  });
});
