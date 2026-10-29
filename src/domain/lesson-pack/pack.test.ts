import { describe, expect, it } from "vitest";
import {
  ALREADY_COUNTED_FOR_STUDENT,
  NOT_A_STUDENT_OF_LESSON,
  isCountable,
  isOpen,
  NO_GRID_PRICE,
  packLabel,
  priceDiffers,
  priceRefusal,
  REASON_REQUIRED,
  remainingLessons,
  saleRefusal,
  OTHER_ENTITY,
  USED_UP,
  usageRefusal,
} from "./pack";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe("remaining lessons", () => {
  it("counts down from the pack size", () => {
    expect(remainingLessons({ lessonCount: 10, usedCount: 3 })).toBe(7);
    expect(remainingLessons({ lessonCount: 5, usedCount: 5 })).toBe(0);
  });

  it("never goes below zero", () => {
    expect(remainingLessons({ lessonCount: 5, usedCount: 6 })).toBe(0);
  });

  it("keeps a pack open until its lessons are used up, whatever its age (Q1: no expiry)", () => {
    expect(isOpen({ lessonCount: 1, usedCount: 0 })).toBe(true);
    expect(isOpen({ lessonCount: 5, usedCount: 4 })).toBe(true);
    expect(isOpen({ lessonCount: 5, usedCount: 5 })).toBe(false);
  });
});

describe("pack label", () => {
  it("says how many lessons remain", () => {
    expect(packLabel({ lessonCount: 10, usedCount: 3 })).toBe("Carnet 10 séances — 7 restantes");
    expect(packLabel({ lessonCount: 5, usedCount: 4 })).toBe("Carnet 5 séances — 1 restante");
  });

  it("says when a pack is used up, in the singular for one lesson", () => {
    expect(packLabel({ lessonCount: 1, usedCount: 1 })).toBe("Carnet 1 séance — épuisé");
  });
});

describe("sale", () => {
  it("accepts one student on a one-person pack", () => {
    expect(saleRefusal({ lessonCount: 10, peopleCount: 1, participantIds: [A] })).toBeNull();
  });

  it("accepts fewer named students than people (a guest from outside the school)", () => {
    expect(saleRefusal({ lessonCount: 5, peopleCount: 3, participantIds: [A, B] })).toBeNull();
  });

  it("refuses more students than the pack is priced for", () => {
    expect(saleRefusal({ lessonCount: 5, peopleCount: 1, participantIds: [A, B] })).toBe(
      "Ce carnet est pour 1 personne : 2 élèves sont choisis.",
    );
  });

  it("refuses a pack without a student, or the same student twice", () => {
    expect(saleRefusal({ lessonCount: 5, peopleCount: 1, participantIds: [] })).toBe("Choisissez au moins un élève.");
    expect(saleRefusal({ lessonCount: 5, peopleCount: 2, participantIds: [A, A] })).toBe(
      "Un élève est choisi deux fois.",
    );
  });

  it("refuses a number of lessons or people that is not a positive integer within the form's bounds", () => {
    expect(saleRefusal({ lessonCount: 0, peopleCount: 1, participantIds: [A] })).toMatch(/séances invalide/);
    expect(saleRefusal({ lessonCount: 2.5, peopleCount: 1, participantIds: [A] })).toMatch(/séances invalide/);
    expect(saleRefusal({ lessonCount: 101, peopleCount: 1, participantIds: [A] })).toMatch(/séances invalide/);
    expect(saleRefusal({ lessonCount: 5, peopleCount: 0, participantIds: [A] })).toMatch(/personnes invalide/);
    expect(saleRefusal({ lessonCount: 5, peopleCount: 11, participantIds: [A] })).toMatch(/personnes invalide/);
  });
});

describe("price", () => {
  it("accepts the grid price without a reason", () => {
    expect(priceRefusal({ gridPriceCents: 40000, priceCents: 40000, reason: "" }, "front_desk")).toBeNull();
  });

  it("asks for a reason when the price differs from the grid", () => {
    expect(priceDiffers({ gridPriceCents: 40000, priceCents: 36000 })).toBe(true);
    expect(priceRefusal({ gridPriceCents: 40000, priceCents: 36000, reason: "  " }, "director")).toBe(REASON_REQUIRED);
  });

  it("lets the front desk and management change the price with a reason (Q4 default)", () => {
    expect(priceRefusal({ gridPriceCents: 40000, priceCents: 36000, reason: "Devis" }, "front_desk")).toBeNull();
    expect(priceRefusal({ gridPriceCents: 40000, priceCents: 36000, reason: "Devis" }, "director")).toBeNull();
    expect(priceRefusal({ gridPriceCents: 40000, priceCents: 36000, reason: "Devis" }, "teacher")).toBe(
      "Votre rôle ne permet pas de changer le prix de la grille.",
    );
  });

  it("requires a price when the grid has no line for the pack, without a reason", () => {
    expect(priceRefusal({ gridPriceCents: null, priceCents: null, reason: "" }, "front_desk")).toBe(NO_GRID_PRICE);
    expect(priceDiffers({ gridPriceCents: null, priceCents: 90000 })).toBe(false);
    expect(priceRefusal({ gridPriceCents: null, priceCents: 90000, reason: "" }, "front_desk")).toBeNull();
  });

  it("accepts a free pack (0 €) and refuses a negative or fractional price", () => {
    expect(priceRefusal({ gridPriceCents: 0, priceCents: 0, reason: "" }, "front_desk")).toBeNull();
    expect(priceRefusal({ gridPriceCents: null, priceCents: -1, reason: "" }, "front_desk")).toBe("Prix invalide.");
    expect(priceRefusal({ gridPriceCents: null, priceCents: 1.5, reason: "" }, "front_desk")).toBe("Prix invalide.");
  });

  it("refuses an overly long reason", () => {
    expect(priceRefusal({ gridPriceCents: 40000, priceCents: 1, reason: "x".repeat(201) }, "director")).toMatch(
      /Motif trop long/,
    );
  });
});

describe("counting a lesson on a pack", () => {
  const open = { lessonCount: 5, usedCount: 4 };
  const usage = (u: Partial<Parameters<typeof usageRefusal>[0]> = {}) =>
    usageRefusal({
      courseType: "private",
      lessonStatus: "planned",
      pack: open,
      packStudentIds: [A],
      lessonStudentIds: [],
      countedStudentIds: [],
      packEntityId: "entity-a",
      courseEntityId: "entity-a",
      ...u,
    });

  it("refuses a pack sold by another business than the lesson's course (#299)", () => {
    expect(usage({ courseEntityId: "entity-b" })).toBe(OTHER_ENTITY);
  });

  it("counts a planned or done private lesson on an open pack", () => {
    expect(usage()).toBeNull();
    expect(usage({ lessonStatus: "done" })).toBeNull();
  });

  it("refuses a 6th lesson on a pack of 5, and a 2nd on a pack of 1", () => {
    expect(usage({ pack: { lessonCount: 5, usedCount: 5 } })).toBe(USED_UP);
    expect(usage({ pack: { lessonCount: 1, usedCount: 1 } })).toBe(USED_UP);
  });

  it("never counts a cancelled lesson (Q2 default)", () => {
    expect(isCountable("cancelled")).toBe(false);
    expect(usage({ lessonStatus: "cancelled" })).toBe("Cette séance est annulée : elle ne se décompte pas.");
  });

  it("counts only lessons of a private course", () => {
    for (const courseType of ["group", "competition", "workshop"] as const)
      expect(usage({ courseType })).toMatch(/cours particulier/);
  });

  it("never counts a student's lesson on two of their packs, but two students may share a lesson (Q3 default)", () => {
    expect(usage({ countedStudentIds: [A] })).toBe(ALREADY_COUNTED_FOR_STUDENT);
    expect(usage({ packStudentIds: [B], countedStudentIds: [A] })).toBeNull();
  });

  it("uses a pack of a student on the sheet when the sheet names students", () => {
    expect(usage({ lessonStudentIds: [B] })).toBe(NOT_A_STUDENT_OF_LESSON);
    expect(usage({ packStudentIds: [A, B], lessonStudentIds: [B] })).toBeNull();
    // A private course without enrollment: any open pack.
    expect(usage({ lessonStudentIds: [] })).toBeNull();
  });
});
