import { describe, expect, it } from "vitest";
import { computeTariff } from "../tariff/compute";
import { ribasGrid, ribasSiblings } from "../tariff/fixtures/ribas-grid-2026";
import type { EnrollmentRequest, EnrollmentResult } from "../tariff/types";
import { entityChangeRefusal, groupByEntity, requestsByEntity, type EntityCourse } from "./entities";

const A = "entity-a";
const B = "entity-b";
const ORDER = [A, B];
const JAZZ = "discipline-jazz";
const CLASSICAL = "discipline-classique";
const ROCK = "discipline-rock";

const course = (courseId: string, billingEntityId: string, disciplineId: string, durationMinutes: number) =>
  ({ courseId, billingEntityId, disciplineId, durationMinutes }) satisfies EntityCourse;

const child = (studentId: string) => ({
  studentIds: [studentId],
  audience: "child" as const,
  period: "quarter" as const,
});

function price(...requests: EnrollmentRequest[]) {
  return computeTariff({ grid: ribasGrid, discounts: [ribasSiblings], enrollments: requests });
}

function ok(r: EnrollmentResult | undefined) {
  if (r?.status !== "ok") throw new Error("expected a priced enrollment");
  return r;
}

describe("groupByEntity", () => {
  it("keeps a single group when every course belongs to the same entity", () => {
    const courses = [course("c1", A, JAZZ, 60), course("c2", A, CLASSICAL, 45)];
    expect(groupByEntity(courses, ORDER)).toEqual([{ billingEntityId: A, courses }]);
  });

  it("splits the courses by entity, in the entities' order (default first)", () => {
    const rock = course("c1", B, ROCK, 60);
    const jazz = course("c2", A, JAZZ, 60);
    const classical = course("c3", B, CLASSICAL, 45);
    expect(groupByEntity([rock, jazz, classical], ORDER)).toEqual([
      { billingEntityId: A, courses: [jazz] },
      { billingEntityId: B, courses: [rock, classical] },
    ]);
  });

  it("puts an entity missing from the order last, in the order the courses came", () => {
    const other = course("c1", "entity-c", JAZZ, 60);
    const jazz = course("c2", A, JAZZ, 60);
    expect(groupByEntity([other, jazz], ORDER).map((g) => g.billingEntityId)).toEqual([A, "entity-c"]);
  });

  it("returns no group without courses", () => {
    expect(groupByEntity([], ORDER)).toEqual([]);
  });
});

describe("requestsByEntity", () => {
  it("makes one request per entity, referenced by the entity, with the same students and formula", () => {
    const requests = requestsByEntity(child("zz-1"), [course("c1", B, ROCK, 60), course("c2", A, JAZZ, 45)], ORDER);
    expect(requests).toEqual([
      { reference: A, ...child("zz-1"), courses: [{ disciplineId: JAZZ, durationMinutes: 45 }] },
      { reference: B, ...child("zz-1"), courses: [{ disciplineId: ROCK, durationMinutes: 60 }] },
    ]);
  });

  it("keeps one request without courses, so the engine says why it cannot price it", () => {
    expect(requestsByEntity(child("zz-1"), [], ORDER)).toEqual([{ reference: A, ...child("zz-1"), courses: [] }]);
  });
});

describe("pricing an enrollment over two entities (#299, #288 Q2 and Q3 defaults)", () => {
  it("prices each enrollment on its own combination, never on the combination of both", () => {
    // Jazz 1 h sold by A, classical 45 min sold by B: 110 € + 85 €, not the « 45 min + 1 h » package (165 €).
    const requests = requestsByEntity(
      child("zz-1"),
      [course("c1", A, JAZZ, 60), course("c2", B, CLASSICAL, 45)],
      ORDER,
    );
    const [a, b] = price(...requests).enrollments;
    expect(ok(a)).toMatchObject({ reference: A, grossPriceCents: 11000, packageLabel: "1 h 00" });
    expect(ok(b)).toMatchObject({ reference: B, grossPriceCents: 8500, packageLabel: "45 min" });
  });

  it("counts a child enrolled with both entities once: no siblings discount on their own", () => {
    const requests = requestsByEntity(child("zz-1"), [course("c1", A, JAZZ, 60), course("c2", B, ROCK, 60)], ORDER);
    const result = price(...requests);
    expect(result.enrollments.map((r) => ok(r).discountCents)).toEqual([0, 0]);
  });

  it("counts siblings across entities, each discount on its own enrollment", () => {
    // One child in jazz at A, the other in rock at B: both are siblings of the same payer.
    const [first] = requestsByEntity(child("zz-1"), [course("c1", A, JAZZ, 60)], ORDER);
    const [second] = requestsByEntity(child("zz-2"), [course("c2", B, ROCK, 45)], ORDER);
    const [a, b] = price({ ...first, reference: "first" }, { ...second, reference: "second" }).enrollments;
    expect(ok(a)).toMatchObject({ grossPriceCents: 11000, discountCents: 1100, netPriceCents: 9900 });
    expect(ok(b)).toMatchObject({ grossPriceCents: 8500, discountCents: 850, netPriceCents: 7650 });
  });

  it("applies the two-disciplines rule to each enrollment on its own", () => {
    // Child 1: jazz and classical both at A (two disciplines on one enrollment), rock at B.
    const requests = requestsByEntity(
      child("zz-1"),
      [course("c1", A, JAZZ, 60), course("c2", A, CLASSICAL, 45), course("c3", B, ROCK, 60)],
      ORDER,
    );
    const sibling = { ...requestsByEntity(child("zz-2"), [course("c4", B, ROCK, 45)], ORDER)[0], reference: "zz-2" };
    const [a, b, c] = price(...requests, sibling).enrollments;
    expect(ok(a)).toMatchObject({ grossPriceCents: 16500, discountCents: 0 });
    expect(ok(a).discounts[0]).toMatchObject({
      status: "rejected",
      reason: "Non cumulable avec un forfait 2 disciplines",
    });
    expect(ok(b)).toMatchObject({ grossPriceCents: 11000, discountCents: 1100 });
    expect(ok(c)).toMatchObject({ grossPriceCents: 8500, discountCents: 850 });
  });
});

describe("entityChangeRefusal", () => {
  it("accepts any entity while the course has no enrollment", () => {
    expect(entityChangeRefusal({ from: A, to: B, enrollments: 0 })).toBeNull();
  });

  it("accepts keeping the same entity on an enrolled course", () => {
    expect(entityChangeRefusal({ from: A, to: A, enrollments: 3 })).toBeNull();
  });

  it("refuses to change the entity of a course with enrollments, in French", () => {
    expect(entityChangeRefusal({ from: A, to: B, enrollments: 1 })).toBe(
      "Ce cours a 1 inscription : l’entreprise qui le vend ne peut plus changer.",
    );
    expect(entityChangeRefusal({ from: A, to: B, enrollments: 2 })).toBe(
      "Ce cours a 2 inscriptions : l’entreprise qui le vend ne peut plus changer.",
    );
  });
});
