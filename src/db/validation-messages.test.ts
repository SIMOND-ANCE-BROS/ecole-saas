import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { validHours, validName, validRoomInput, validSeasonInput, validSiteInput } from "./settings";
import { validCell, validLessonPack, validSiblings } from "./tariffs";
import { validInvitation } from "./team";

/**
 * Settings and tariff refusals reach the user as they are (#250): every
 * message must be French and say what to fix, never Zod's English default.
 */
// « invalide » is French; Zod's « Invalid UUID / email / ISO date » defaults are caught by `\binvalid\b`.
const ENGLISH = /\binvalid\b|expected|too (big|small)|must|string|number|received|\bnan\b/i;

const UUID = "00000000-0000-4000-8000-000000000000";
const long = (n: number) => "a".repeat(n);

const cases: [string, z.ZodType, unknown[]][] = [
  ["name", validName, [undefined, 3, "", "   ", long(101)]],
  [
    "season",
    validSeasonInput,
    [
      null,
      "x",
      {},
      { label: 3, startDate: "2026-09-01", endDate: "2027-06-30" },
      { label: "", startDate: "2026-09-01", endDate: "2027-06-30" },
      { label: long(31), startDate: "2026-09-01", endDate: "2027-06-30" },
      { label: "2026", startDate: "01/09/2026", endDate: "2027-06-30" },
      { label: "2026", startDate: "2027-06-30", endDate: "2026-09-01" },
    ],
  ],
  [
    "site",
    validSiteInput,
    [
      null,
      { name: "Centre", address: 3, permanence: false },
      { name: "Centre", address: "", permanence: false },
      { name: "Centre", address: long(301), permanence: false },
      { name: "Centre", address: "1 rue", permanence: "oui" },
      { name: long(101), address: "1 rue", permanence: false },
    ],
  ],
  [
    "hours",
    validHours,
    [
      null,
      [null],
      [{ weekday: 0, opening: "09:00", closure: "12:00" }],
      [{ weekday: 8, opening: "09:00", closure: "12:00" }],
      [{ weekday: 1.5, opening: "09:00", closure: "12:00" }],
      [{ weekday: 1, opening: 9, closure: "12:00" }],
      [{ weekday: 1, opening: "9h", closure: "12:00" }],
      Array.from({ length: 8 }, (_, i) => ({ weekday: (i % 7) + 1, opening: "09:00", closure: "12:00" })),
    ],
  ],
  [
    "room",
    validRoomInput,
    [
      null,
      { siteId: "x", name: "Salle 1", capacity: null },
      { siteId: UUID, name: "Salle 1", capacity: 0 },
      { siteId: UUID, name: "Salle 1", capacity: 1001 },
      { siteId: UUID, name: "Salle 1", capacity: 2.5 },
      { siteId: UUID, name: "Salle 1", capacity: Number.NaN },
      { siteId: UUID, name: "Salle 1", capacity: "12" },
    ],
  ],
  [
    "tariff cell",
    validCell,
    [
      null,
      { audience: "x", combination: [60], disciplineId: null, period: "year", priceCents: 1000 },
      { audience: "child", combination: [], disciplineId: null, period: "year", priceCents: 1000 },
      { audience: "child", combination: "60", disciplineId: null, period: "year", priceCents: 1000 },
      { audience: "child", combination: [4], disciplineId: null, period: "year", priceCents: 1000 },
      { audience: "child", combination: [601], disciplineId: null, period: "year", priceCents: 1000 },
      {
        audience: "child",
        combination: [60, 60, 60, 60, 60, 60, 60],
        disciplineId: null,
        period: "year",
        priceCents: 1,
      },
      { audience: "child", combination: [60], disciplineId: "x", period: "year", priceCents: 1000 },
      { audience: "child", combination: [60], disciplineId: null, period: "month", priceCents: 1000 },
      { audience: "child", combination: [60], disciplineId: null, period: "year", priceCents: -1 },
      { audience: "child", combination: [60], disciplineId: null, period: "year", priceCents: 1_000_001 },
      { audience: "child", combination: [60], disciplineId: null, period: "year", priceCents: 10.5 },
    ],
  ],
  [
    "siblings discount",
    validSiblings,
    [
      null,
      { rateBps: 0, amountCents: null, minStudents: 2, audiences: [], combinableWithMultiDiscipline: false },
      { rateBps: 10001, amountCents: null, minStudents: 2, audiences: [], combinableWithMultiDiscipline: false },
      { rateBps: null, amountCents: 0, minStudents: 2, audiences: [], combinableWithMultiDiscipline: false },
      { rateBps: null, amountCents: 1_000_001, minStudents: 2, audiences: [], combinableWithMultiDiscipline: false },
      { rateBps: 1000, amountCents: null, minStudents: 1, audiences: [], combinableWithMultiDiscipline: false },
      { rateBps: 1000, amountCents: null, minStudents: 11, audiences: [], combinableWithMultiDiscipline: false },
      {
        rateBps: 1000,
        amountCents: null,
        minStudents: Number.NaN,
        audiences: [],
        combinableWithMultiDiscipline: false,
      },
      { rateBps: 1000, amountCents: null, minStudents: 2, audiences: ["x"], combinableWithMultiDiscipline: false },
      { rateBps: 1000, amountCents: null, minStudents: 2, audiences: "child", combinableWithMultiDiscipline: false },
      { rateBps: 1000, amountCents: null, minStudents: 2, audiences: [], combinableWithMultiDiscipline: "non" },
      { rateBps: 1000, amountCents: 500, minStudents: 2, audiences: [], combinableWithMultiDiscipline: false },
    ],
  ],
  [
    "lesson pack",
    validLessonPack,
    [
      null,
      { lessonCount: 0, maxPeople: 1, priceCents: 1000 },
      { lessonCount: 101, maxPeople: 1, priceCents: 1000 },
      { lessonCount: 5, maxPeople: 0, priceCents: 1000 },
      { lessonCount: 5, maxPeople: 21, priceCents: 1000 },
      { lessonCount: 5, maxPeople: 1, priceCents: -1 },
      { lessonCount: 5, maxPeople: 1, priceCents: 1_000_001 },
      { lessonCount: "5", maxPeople: 1, priceCents: 1000 },
    ],
  ],
  [
    "invitation",
    validInvitation,
    [
      null,
      { email: "x", name: "Zz Test", role: "front_desk" },
      { email: 3, name: "Zz Test", role: "front_desk" },
      { email: `${long(200)}@exemple.fr`, name: "Zz Test", role: "front_desk" },
      { email: "zz@exemple.fr", name: "", role: "front_desk" },
      { email: "zz@exemple.fr", name: long(101), role: "front_desk" },
      { email: "zz@exemple.fr", name: "Zz Test", role: "admin" },
      // A teacher account is never created by invitation.
      { email: "zz@exemple.fr", name: "Zz Test", role: "teacher" },
    ],
  ],
];

describe("settings and tariff validation messages", () => {
  for (const [label, schema, inputs] of cases) {
    it(`refuses every invalid ${label} with a French message`, () => {
      for (const input of inputs) {
        const r = schema.safeParse(input);
        expect(r.success, JSON.stringify(input)).toBe(false);
        if (r.success) continue;
        for (const issue of r.error.issues) expect(issue.message, JSON.stringify(input)).not.toMatch(ENGLISH);
      }
    });
  }

  it("states the highest price in euros", () => {
    const r = validLessonPack.safeParse({ lessonCount: 5, maxPeople: 1, priceCents: 1_000_001 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/^Prix au plus 10\s000,00\s€$/u);
  });

  it("still accepts every boundary value", () => {
    const cell = { audience: "child", combination: [60], disciplineId: null, period: "year", priceCents: 1000 };
    const siblings = {
      rateBps: 1000,
      amountCents: null,
      minStudents: 2,
      audiences: ["child"],
      combinableWithMultiDiscipline: false,
    };
    const accepted: [z.ZodType, unknown][] = [
      [validName, "Jazz"],
      [validName, long(100)],
      [validRoomInput, { siteId: UUID, name: "Salle 1", capacity: null }],
      [validRoomInput, { siteId: UUID, name: "Salle 1", capacity: 1 }],
      [validRoomInput, { siteId: UUID, name: "Salle 1", capacity: 1000 }],
      [validHours, [{ weekday: 1, opening: "09:00", closure: "12:00" }]],
      [validHours, [{ weekday: 7, opening: "09:00", closure: "12:00" }]],
      [validHours, Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, opening: "09:00", closure: "12:00" }))],
      [validCell, { ...cell, priceCents: 0 }],
      [validCell, { ...cell, priceCents: 1_000_000 }],
      [validCell, { ...cell, combination: [5, 600] }],
      [validCell, { ...cell, combination: [60, 60, 60, 60, 60, 60] }],
      [validLessonPack, { lessonCount: 10, maxPeople: 4, priceCents: 0 }],
      [validLessonPack, { lessonCount: 10, maxPeople: 4, priceCents: 1_000_000 }],
      [validSiblings, siblings],
      [validSiblings, { ...siblings, rateBps: 10000, minStudents: 10 }],
    ];
    for (const [schema, input] of accepted) expect(schema.safeParse(input).success, JSON.stringify(input)).toBe(true);
  });
});
