import { describe, expect, it } from "vitest";
import {
  canChange,
  confirmationPrice,
  dropDateRefusal,
  enrollmentActions,
  onAttendanceSheet,
  onCourseList,
  oneRowPerStudent,
  SIBLING_STATUSES,
  transitionRefusal,
} from "./lifecycle";
import { ENROLLMENT_STATUS_LABELS, type EnrollmentStatus } from "./statuses";

const STATUSES = Object.keys(ENROLLMENT_STATUS_LABELS) as EnrollmentStatus[];

describe("status changes", () => {
  it("allows exactly: trial or waitlist confirmed, and a drop-out from trial, waitlist or active", () => {
    const allowed = STATUSES.flatMap((from) =>
      STATUSES.filter((to) => canChange(from, to)).map((to) => `${from}→${to}`),
    );
    expect(allowed.sort()).toEqual(
      ["active→dropped", "trial→active", "trial→dropped", "waitlist→active", "waitlist→dropped"].sort(),
    );
  });

  it("refuses going back from a drop-out or an ended enrollment, with a French message", () => {
    expect(transitionRefusal("dropped", "trial")).toBe(
      "Cette inscription est abandonnée : elle ne peut plus changer de statut.",
    );
    for (const to of STATUSES) expect(transitionRefusal("ended", to)).toMatch(/terminée/);
    expect(transitionRefusal("active", "trial")).toBe("Ce changement de statut n’est pas possible.");
    expect(transitionRefusal("waitlist", "trial")).not.toBeNull();
  });

  it("says when the enrollment is already confirmed or already dropped (a second click)", () => {
    expect(transitionRefusal("active", "active")).toBe("Cette inscription est déjà confirmée.");
    expect(transitionRefusal("dropped", "dropped")).toBe("L’abandon de cette inscription est déjà enregistré.");
  });

  it("has no message for an allowed change", () => {
    expect(transitionRefusal("trial", "active")).toBeNull();
    expect(transitionRefusal("active", "dropped")).toBeNull();
  });
});

describe("enrollmentActions", () => {
  it("offers to confirm a trial or waitlist enrollment, never an active one", () => {
    expect(enrollmentActions("trial", false)).toEqual({ confirm: true, drop: true, cancel: true });
    expect(enrollmentActions("waitlist", false)).toEqual({ confirm: true, drop: true, cancel: true });
    expect(enrollmentActions("active", false)).toEqual({ confirm: false, drop: true, cancel: true });
  });

  it("offers nothing but cancelling a mistake on a dropped or ended enrollment", () => {
    expect(enrollmentActions("dropped", false)).toEqual({ confirm: false, drop: false, cancel: true });
    expect(enrollmentActions("ended", false)).toEqual({ confirm: false, drop: false, cancel: true });
  });

  it("never offers to cancel an invoiced enrollment (a credit note is the way back)", () => {
    for (const s of STATUSES) expect(enrollmentActions(s, true).cancel).toBe(false);
  });
});

describe("siblings (Q3 default)", () => {
  it("counts only active enrollments as siblings", () => {
    expect([...SIBLING_STATUSES]).toEqual(["active"]);
  });
});

describe("attendance sheets and course lists", () => {
  it("lists active and trial students, never the waitlist", () => {
    expect(onAttendanceSheet("active", null, "2027-11-20")).toBe(true);
    expect(onAttendanceSheet("trial", null, "2027-11-20")).toBe(true);
    expect(onAttendanceSheet("waitlist", null, "2027-11-20")).toBe(false);
    expect(onAttendanceSheet("ended", null, "2027-11-20")).toBe(false);
  });

  it("keeps a drop-out on lessons up to the drop date included, not after", () => {
    expect(onAttendanceSheet("dropped", "2027-11-15", "2027-11-08")).toBe(true);
    expect(onAttendanceSheet("dropped", "2027-11-15", "2027-11-15")).toBe(true);
    expect(onAttendanceSheet("dropped", "2027-11-15", "2027-11-16")).toBe(false);
  });

  it("leaves out a drop-out without a date (written before the drop date existed)", () => {
    expect(onAttendanceSheet("dropped", null, "2026-09-01")).toBe(false);
  });

  it("shows the waitlist on the course list, and a drop-out until the drop date", () => {
    expect(onCourseList("waitlist", null, "2027-11-20")).toBe(true);
    expect(onCourseList("dropped", "2027-11-30", "2027-11-20")).toBe(true);
    expect(onCourseList("dropped", "2027-11-15", "2027-11-20")).toBe(false);
  });
});

describe("dropDateRefusal", () => {
  const season = { startDate: "2027-09-01", endDate: "2028-06-30" };
  it("accepts a date within the season, bounds included", () => {
    expect(dropDateRefusal("2027-11-15", season)).toBeNull();
    expect(dropDateRefusal("2027-09-01", season)).toBeNull();
    expect(dropDateRefusal("2028-06-30", season)).toBeNull();
  });

  it("refuses a date outside the season, or no date", () => {
    expect(dropDateRefusal("2027-08-31", season)).toBe(
      "La date de l’abandon doit être comprise dans la saison de l’inscription.",
    );
    expect(dropDateRefusal("2028-07-01", season)).not.toBeNull();
    expect(dropDateRefusal("", season)).toBe("Indiquez la date de l’abandon.");
  });
});

describe("confirmationPrice (Q4 default)", () => {
  it("saves the price recomputed at confirmation, not the one shown at trial time", () => {
    expect(
      confirmationPrice(
        { grossPriceCents: 11_000, discountCents: 0 },
        { grossPriceCents: 11_000, discountCents: 1_100 },
      ),
    ).toEqual({ grossPriceCents: 11_000, discountCents: 1_100 });
  });
});

describe("oneRowPerStudent", () => {
  it("keeps one row per student, the most favourable status, in the given order", () => {
    const rows = [
      { student: "a", status: "dropped" as const },
      { student: "a", status: "trial" as const },
      { student: "b", status: "waitlist" as const },
      { student: "a", status: "active" as const },
      { student: "c", status: "trial" as const },
    ];
    expect(oneRowPerStudent(rows, (r) => r.student)).toEqual([
      { student: "b", status: "waitlist" },
      { student: "a", status: "active" },
      { student: "c", status: "trial" },
    ]);
  });
});
