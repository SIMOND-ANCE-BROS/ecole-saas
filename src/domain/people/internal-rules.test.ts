import { describe, expect, it } from "vitest";
import {
  defaultAcceptedOn,
  normalisedRules,
  REFERRAL_LABEL_MAX,
  referralKey,
  referralRefusal,
  REFUSES_PHOTOS_DEFAULT,
  rulesChanged,
  rulesMissing,
} from "./internal-rules";

const TODAY = "2026-10-29";

describe("defaultAcceptedOn", () => {
  it("is the payer's first enrollment day of the season", () => {
    expect(defaultAcceptedOn("2026-09-07", TODAY)).toBe("2026-09-07");
  });

  it("is today for a payer not enrolled yet", () => {
    expect(defaultAcceptedOn(null, TODAY)).toBe(TODAY);
  });

  it("is never after today, even for an enrollment dated ahead", () => {
    expect(defaultAcceptedOn("2026-11-02", TODAY)).toBe(TODAY);
  });
});

describe("rulesChanged", () => {
  it("sees a first text as a change", () => {
    expect(rulesChanged(null, "Version du 29 octobre 2026")).toBe(true);
  });

  it("ignores blanks around and Windows line ends", () => {
    expect(rulesChanged("Article 1\nArticle 2", "  Article 1\r\nArticle 2\r\n")).toBe(false);
  });

  it("sees a changed word", () => {
    expect(rulesChanged("Article 1", "Article 1 bis")).toBe(true);
  });

  it("sees nothing new in an empty text when none was kept", () => {
    expect(rulesChanged(null, "   ")).toBe(false);
  });

  it("keeps the text itself, trimmed, with its inner lines", () => {
    expect(normalisedRules("\r\n  Article 1\r\n\r\nArticle 2  ")).toBe("Article 1\n\nArticle 2");
  });
});

describe("referralRefusal", () => {
  const offered = ["Bouche à oreille", "Réseaux sociaux"];

  it("accepts a new answer", () => {
    expect(referralRefusal("Ancien élève", offered)).toBeNull();
  });

  it("refuses an empty answer", () => {
    expect(referralRefusal("   ", offered)).toBe("Indiquez la réponse.");
  });

  it("refuses an answer already offered, case and spaces aside", () => {
    expect(referralRefusal("  bouche  À oreille ", offered)).toBe("« bouche À oreille » est déjà proposée.");
  });

  it("refuses an answer too long", () => {
    expect(referralRefusal("x".repeat(REFERRAL_LABEL_MAX + 1), offered)).toMatch(/au plus/);
    expect(referralRefusal("x".repeat(REFERRAL_LABEL_MAX), offered)).toBeNull();
  });

  it("refuses the label of the students without an answer", () => {
    expect(referralRefusal(" non  RENSEIGNÉ", offered)).toBe("« Non renseigné » désigne déjà les élèves sans réponse.");
  });

  it("compares answers by their words", () => {
    expect(referralKey(" Moteurs  de recherche ")).toBe(referralKey("moteurs de recherche"));
  });
});

describe("rulesMissing", () => {
  it("is missing while a payer of an enrollment has not signed", () => {
    expect(rulesMissing(true, [{ payerId: "a", enrolled: true, acceptedOn: null }])).toBe(true);
  });

  it("asks no signature of a school that recorded no rules for the season", () => {
    expect(rulesMissing(false, [{ payerId: "a", enrolled: true, acceptedOn: null }])).toBe(false);
  });

  it("is not missing once every enrolled payer signed", () => {
    expect(
      rulesMissing(true, [
        { payerId: "a", enrolled: true, acceptedOn: "2026-09-07" },
        { payerId: "b", enrolled: false, acceptedOn: null },
      ]),
    ).toBe(false);
  });

  it("asks one signature per payer: a second business's enrollment by another payer counts too", () => {
    expect(
      rulesMissing(true, [
        { payerId: "a", enrolled: true, acceptedOn: "2026-09-07" },
        { payerId: "b", enrolled: true, acceptedOn: null },
      ]),
    ).toBe(true);
  });

  it("asks nothing of a student without enrollment", () => {
    expect(rulesMissing(true, [])).toBe(false);
  });
});

describe("photos", () => {
  it("are not refused by default (#296 Q1)", () => {
    expect(REFUSES_PHOTOS_DEFAULT).toBe(false);
  });
});
