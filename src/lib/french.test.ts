import { describe, expect, it } from "vitest";
import { ofName } from "./french";

describe("ofName", () => {
  it("elides before a vowel, accented or not, and before an h", () => {
    expect(ofName("Émilie")).toBe("d’Émilie");
    expect(ofName("alice")).toBe("d’alice");
    expect(ofName("Inès")).toBe("d’Inès");
    expect(ofName("Hugo")).toBe("d’Hugo");
  });

  it("keeps « de » before a consonant", () => {
    expect(ofName("Jules")).toBe("de Jules");
    expect(ofName("Zzprénom")).toBe("de Zzprénom");
    expect(ofName("Yanis")).toBe("de Yanis");
  });

  it("does not elide a phrase starting with an article", () => {
    expect(ofName("l’élève")).toBe("de l’élève");
  });
});
