import { describe, expect, it } from "vitest";
import {
  DEFAULT_REQUIREMENTS,
  documentsToBring,
  documentState,
  effectiveRequirements,
  expectedDocuments,
  missingDocuments,
  type ReceivedDocument,
  type Requirement,
  validUntilFor,
} from "./documents";

const TODAY = "2026-10-29";
const CHILD = "2015-03-10";
const ADULT = "1996-04-05";
const defaults = effectiveRequirements([]);
/** Every type asked, as a school may set it: consent for minors only. */
const all = defaults.map((r) => ({ ...r, required: true }));

const doc = (type: ReceivedDocument["type"], fields: Partial<ReceivedDocument> = {}): ReceivedDocument => ({
  type,
  receivedOn: "2026-09-10",
  granted: true,
  validUntil: null,
  ...fields,
});

describe("effectiveRequirements", () => {
  it("falls back on the school's answers of #287 for every type it never set", () => {
    expect(defaults).toEqual([
      { type: "medical_certificate", required: true, minorsOnly: false, validityMonths: 36, dueWithinDays: 15 },
      { type: "parental_consent", required: false, minorsOnly: true, validityMonths: null, dueWithinDays: 15 },
      { type: "image_rights", required: false, minorsOnly: false, validityMonths: null, dueWithinDays: 15 },
    ]);
  });

  it("keeps what the school saved, type by type", () => {
    const saved: Requirement[] = [
      { type: "image_rights", required: true, minorsOnly: false, validityMonths: null, dueWithinDays: 7 },
    ];
    const r = effectiveRequirements(saved);
    expect(r.find((x) => x.type === "image_rights")).toMatchObject({ required: true, dueWithinDays: 7 });
    expect(r.find((x) => x.type === "medical_certificate")).toEqual({
      type: "medical_certificate",
      ...DEFAULT_REQUIREMENTS.medical_certificate,
    });
  });
});

describe("validUntilFor", () => {
  it("keeps a certificate valid three years from its date, its anniversary excluded", () => {
    expect(validUntilFor("2025-09-10", 36)).toBe("2028-09-09");
    expect(validUntilFor("2026-09-10", 12)).toBe("2027-09-09");
  });

  it("stays within the month (29 February)", () => {
    expect(validUntilFor("2028-02-29", 12)).toBe("2029-02-27");
    expect(validUntilFor("2027-03-01", 12)).toBe("2028-02-29");
  });

  it("never expires without a validity", () => {
    expect(validUntilFor("2026-09-10", null)).toBeNull();
  });
});

describe("documentState", () => {
  it("is missing when nothing was recorded", () => {
    expect(documentState(undefined, TODAY)).toBe("missing");
  });

  it("stays valid on its last day and expires the day after", () => {
    expect(documentState(doc("medical_certificate", { validUntil: TODAY }), TODAY)).toBe("received");
    expect(documentState(doc("medical_certificate", { validUntil: "2026-10-28" }), TODAY)).toBe("expired");
  });

  it("tells a refusal apart from a received document", () => {
    expect(documentState(doc("image_rights", { granted: false }), TODAY)).toBe("refused");
  });
});

describe("expectedDocuments", () => {
  it("asks only the medical certificate by default, of children and adults alike", () => {
    expect(expectedDocuments(defaults, CHILD, TODAY)).toEqual(["medical_certificate"]);
    expect(expectedDocuments(defaults, ADULT, TODAY)).toEqual(["medical_certificate"]);
  });

  it("asks a document set for minors only of students under 18 on the day", () => {
    expect(expectedDocuments(all, CHILD, TODAY)).toEqual(["medical_certificate", "parental_consent", "image_rights"]);
    expect(expectedDocuments(all, ADULT, TODAY)).toEqual(["medical_certificate", "image_rights"]);
    expect(expectedDocuments(all, "2008-10-29", TODAY)).not.toContain("parental_consent");
    expect(expectedDocuments(all, "2008-10-30", TODAY)).toContain("parental_consent");
  });

  it("treats an unknown birth date as an adult, like the rest of the record", () => {
    expect(expectedDocuments(all, null, TODAY)).toEqual(["medical_certificate", "image_rights"]);
  });

  it("drops what the school does not ask for", () => {
    const none = defaults.map((r) => ({ ...r, required: false }));
    expect(expectedDocuments(none, CHILD, TODAY)).toEqual([]);
  });
});

describe("documentsToBring", () => {
  const base = { requirements: defaults, birthDate: CHILD, today: TODAY };

  it("gives the certificate 15 days from the enrollment (the school's example)", () => {
    const r = documentsToBring({ ...base, documents: [], enrolledOn: "2027-06-20", today: "2027-06-21" });
    expect(r).toEqual([{ type: "medical_certificate", dueOn: "2027-07-05", overdue: false }]);
  });

  it("is due on its last day and overdue the day after", () => {
    const on = (today: string) => documentsToBring({ ...base, documents: [], enrolledOn: "2027-06-20", today });
    expect(on("2027-07-05")[0].overdue).toBe(false);
    expect(on("2027-07-06")[0].overdue).toBe(true);
  });

  it("asks nothing of a student not enrolled this season", () => {
    expect(documentsToBring({ ...base, documents: [], enrolledOn: null })).toEqual([]);
  });

  it("asks again for an expired certificate, overdue when the enrollment is older than the delay", () => {
    const documents = [doc("medical_certificate", { validUntil: "2026-10-01" })];
    expect(documentsToBring({ ...base, documents, enrolledOn: "2026-09-05" })).toEqual([
      { type: "medical_certificate", dueOn: "2026-09-20", overdue: true },
    ]);
  });

  it("asks nothing once a valid certificate is in", () => {
    const documents = [doc("medical_certificate", { validUntil: "2029-09-09" })];
    expect(documentsToBring({ ...base, documents, enrolledOn: "2026-09-05" })).toEqual([]);
  });

  it("follows each type's own delay and accepts a refusal as an answer", () => {
    const requirements = all.map((r) => (r.type === "parental_consent" ? { ...r, dueWithinDays: 60 } : r));
    const documents = [doc("image_rights", { granted: false })];
    expect(documentsToBring({ ...base, requirements, documents, enrolledOn: "2026-09-05" })).toEqual([
      { type: "medical_certificate", dueOn: "2026-09-20", overdue: true },
      { type: "parental_consent", dueOn: "2026-11-04", overdue: false },
    ]);
  });

  it("accepts a document recorded before #287, without a reception date", () => {
    const documents = [doc("medical_certificate", { receivedOn: null })];
    expect(documentsToBring({ ...base, documents, enrolledOn: "2026-09-05" })).toEqual([]);
  });
});

describe("missingDocuments", () => {
  it("keeps only the overdue documents, for the students list", () => {
    const requirements = all.map((r) => (r.type === "parental_consent" ? { ...r, dueWithinDays: 60 } : r));
    expect(
      missingDocuments({ requirements, documents: [], birthDate: CHILD, enrolledOn: "2026-09-05", today: TODAY }),
    ).toEqual(["medical_certificate", "image_rights"]);
  });
});
