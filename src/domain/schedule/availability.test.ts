import { describe, expect, it } from "vitest";
import { conflicts, instantParis, lessonInterval, freeSubstitutes } from "./availability";

const iso = (t: number) => new Date(t).toISOString();

describe("instantParis", () => {
  it("converts a Paris time into an instant, in summer and winter", () => {
    expect(iso(instantParis("2026-07-01", "18:00"))).toBe("2026-07-01T16:00:00.000Z");
    expect(iso(instantParis("2026-12-01", "18:00"))).toBe("2026-12-01T17:00:00.000Z");
  });

  it("accounts for daylight saving time change days", () => {
    expect(iso(instantParis("2026-03-29", "10:00"))).toBe("2026-03-29T08:00:00.000Z"); // switch to summer time
    expect(iso(instantParis("2026-10-25", "10:00"))).toBe("2026-10-25T09:00:00.000Z"); // back to winter time
  });
});

describe("lessonInterval", () => {
  it("gives the start and end of a lesson", () => {
    const [start, end] = lessonInterval({ date: "2026-11-04", startTime: "14:00", durationMinutes: 45 });
    expect([iso(start), iso(end)]).toEqual(["2026-11-04T13:00:00.000Z", "2026-11-04T13:45:00.000Z"]);
  });
});

const lesson = (id: string, date: string, startTime: string, instructorId: string, durationMinutes = 60) => ({
  id,
  date,
  startTime: startTime,
  durationMinutes: durationMinutes,
  instructorId: instructorId,
});
const unavailability = (instructorId: string, start: string, end: string) => ({
  instructorId: instructorId,
  start: new Date(start),
  end: new Date(end),
});

describe("conflicts", () => {
  it("finds an instructor's lessons overlapping their unavailabilities, bounds excluded", () => {
    const lessons = [
      lesson("a", "2026-11-04", "17:00", "camille"), // 16:00–17:00 UTC
      lesson("b", "2026-11-04", "18:00", "camille"), // 17:00–18:00 UTC: starts when the unavailability ends
      lesson("c", "2026-11-04", "17:00", "ines"),
    ];
    const unavailabilities = [unavailability("camille", "2026-11-04T15:30:00Z", "2026-11-04T17:00:00Z")];
    expect(conflicts(lessons, unavailabilities).map((c) => c.lessonId)).toEqual(["a"]);
  });
});

describe("freeSubstitutes", () => {
  const instructors = [
    { id: "camille", disciplines: ["Jazz"] },
    { id: "ines", disciplines: ["Éveil"] },
    { id: "lucas", disciplines: ["Jazz", "Zumba"] },
    { id: "mathis", disciplines: ["Jazz"] },
  ];

  it("ranks free instructors first, those teaching the discipline on top, and gives the others' reason", () => {
    const target = { ...lesson("s", "2026-11-04", "17:00", "camille"), discipline: "Jazz" };
    const other = [lesson("x", "2026-11-04", "17:30", "lucas")];
    const unavailabilities = [unavailability("mathis", "2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z")];
    expect(freeSubstitutes(target, instructors, other, unavailabilities)).toEqual([
      { id: "ines", free: true, pattern: null, taught: false },
      { id: "lucas", free: false, pattern: "autre séance", taught: true },
      { id: "mathis", free: false, pattern: "indisponible", taught: true },
    ]);
  });
});
