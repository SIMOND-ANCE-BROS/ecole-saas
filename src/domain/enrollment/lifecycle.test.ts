import { describe, expect, it } from "vitest";
import {
  canChange,
  confirmationPrice,
  countsAsSibling,
  cancelRefusal,
  dropDateBounds,
  dropDateRefusal,
  enrollmentActions,
  fullCourseAdvice,
  INITIAL_STATUSES,
  isChildrenCourse,
  onAttendanceSheet,
  onCourseList,
  oneRowPerStudent,
  SIBLING_STATUSES,
  transitionRefusal,
} from "./lifecycle";
import { ENROLLMENT_STATUS_LABELS, type EnrollmentStatus } from "./statuses";

const STATUSES = Object.keys(ENROLLMENT_STATUS_LABELS) as EnrollmentStatus[];

describe("status changes", () => {
  it("allows exactly: trial or waitlist confirmed, and a drop-out from trial or active", () => {
    const allowed = STATUSES.flatMap((from) =>
      STATUSES.filter((to) => canChange(from, to)).map((to) => `${from}→${to}`),
    );
    expect(allowed.sort()).toEqual(["active→dropped", "trial→active", "trial→dropped", "waitlist→active"].sort());
  });

  it("refuses going back from a drop-out or an ended enrollment, with a French message", () => {
    expect(transitionRefusal("dropped", "trial")).toBe(
      "Cette inscription est abandonnée : elle ne peut plus changer de statut.",
    );
    for (const to of STATUSES) expect(transitionRefusal("ended", to)).toMatch(/terminée/);
    expect(transitionRefusal("active", "trial")).toBe("Ce changement de statut n’est pas possible.");
    expect(transitionRefusal("waitlist", "trial")).not.toBeNull();
  });

  it("refuses a drop-out from the waitlist (never attended): cancel it instead", () => {
    expect(transitionRefusal("waitlist", "dropped")).toBe(
      "Une inscription en attente n’a jamais été suivie : annulez-la plutôt.",
    );
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
  const free = { invoiced: false, attended: false };
  it("offers to confirm a trial or waitlist enrollment, never an active one", () => {
    expect(enrollmentActions("trial", free)).toEqual({ confirm: true, drop: true, cancel: true });
    expect(enrollmentActions("waitlist", free)).toEqual({ confirm: true, drop: false, cancel: true });
    expect(enrollmentActions("active", free)).toEqual({ confirm: false, drop: true, cancel: true });
  });

  it("offers nothing but cancelling a mistake on a dropped or ended enrollment", () => {
    expect(enrollmentActions("dropped", free)).toEqual({ confirm: false, drop: false, cancel: true });
    expect(enrollmentActions("ended", free)).toEqual({ confirm: false, drop: false, cancel: true });
  });

  it("never offers to cancel an invoiced enrollment (a credit note is the way back)", () => {
    for (const s of STATUSES) expect(enrollmentActions(s, { invoiced: true, attended: false }).cancel).toBe(false);
  });

  it("never offers to cancel an enrollment already attended (a drop-out is what happened)", () => {
    for (const s of STATUSES) expect(enrollmentActions(s, { invoiced: false, attended: true }).cancel).toBe(false);
  });
});

describe("cancelRefusal", () => {
  it("tells why cancelling is refused, the invoice first", () => {
    expect(cancelRefusal({ invoiced: true, attended: true })).toBe(
      "Cette inscription est facturée : passez par un avoir.",
    );
    expect(cancelRefusal({ invoiced: false, attended: true })).toBe(
      "Des présences sont déjà relevées pour cette inscription : enregistrez plutôt un abandon.",
    );
    expect(cancelRefusal({ invoiced: false, attended: false })).toBeNull();
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

describe("drop-out dates", () => {
  const season = { startDate: "2027-09-01", endDate: "2028-06-30" };
  it("run from the season start, or the enrollment day if later, to the season end", () => {
    expect(dropDateBounds("2027-06-25", season)).toEqual({ min: "2027-09-01", max: "2028-06-30" });
    expect(dropDateBounds("2027-10-05", season)).toEqual({ min: "2027-10-05", max: "2028-06-30" });
  });

  it("accepts a date within the bounds, bounds included", () => {
    const bounds = dropDateBounds("2027-06-25", season);
    expect(dropDateRefusal("2027-11-15", bounds)).toBeNull();
    expect(dropDateRefusal("2027-09-01", bounds)).toBeNull();
    expect(dropDateRefusal("2028-06-30", bounds)).toBeNull();
  });

  it("refuses a date after the season, before the enrollment or the season, or no date", () => {
    const bounds = dropDateBounds("2027-10-05", season);
    expect(dropDateRefusal("2028-07-01", bounds)).toBe(
      "La date de l’abandon doit être comprise dans la saison de l’inscription.",
    );
    expect(dropDateRefusal("2027-10-04", bounds)).toBe(
      "La date de l’abandon ne peut pas précéder l’inscription ni le début de la saison.",
    );
    expect(dropDateRefusal("", bounds)).toBe("Indiquez la date de l’abandon.");
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
  it("keeps one row per student, an attending one before the waitlist, in the given order", () => {
    const rows = [
      { student: "a", status: "dropped" as const },
      { student: "a", status: "trial" as const },
      { student: "b", status: "waitlist" as const },
      { student: "a", status: "active" as const },
      { student: "c", status: "trial" as const },
      { student: "d", status: "waitlist" as const },
      { student: "d", status: "dropped" as const },
    ];
    expect(oneRowPerStudent(rows, (r) => r.student)).toEqual([
      { student: "b", status: "waitlist" },
      { student: "a", status: "active" },
      { student: "c", status: "trial" },
      { student: "d", status: "dropped" },
    ]);
  });
});

describe("status at creation", () => {
  it("offers « Inscrit » first (the default), then trial and waitlist", () => {
    expect([...INITIAL_STATUSES]).toEqual(["active", "trial", "waitlist"]);
  });

  it("counts only an active new enrollment as a sibling", () => {
    expect(INITIAL_STATUSES.filter(countsAsSibling)).toEqual(["active"]);
  });
});

describe("fullCourseAdvice (Q5 default, children's courses only)", () => {
  const children = { ageMax: 11 };
  it("suggests the waitlist when a chosen children's course is full of active enrollments", () => {
    expect(fullCourseAdvice("active", [{ enrolled: 20, maxCapacity: 20, ...children }])).toBe("suggest_waitlist");
    expect(
      fullCourseAdvice("active", [
        { enrolled: 3, maxCapacity: 20, ...children },
        { enrolled: 21, maxCapacity: 20, ...children },
      ]),
    ).toBe("suggest_waitlist");
  });

  it("never calls an adult course full, even at capacity", () => {
    expect(fullCourseAdvice("active", [{ enrolled: 30, maxCapacity: 20, ageMax: null }])).toBe("none");
    expect(fullCourseAdvice("active", [{ enrolled: 30, maxCapacity: 20, ageMax: 99 }])).toBe("none");
  });

  it("says nothing below capacity, without a capacity, or for a trial or waitlist enrollment", () => {
    expect(fullCourseAdvice("active", [{ enrolled: 19, maxCapacity: 20, ...children }])).toBe("none");
    expect(fullCourseAdvice("active", [{ enrolled: 99, maxCapacity: null, ...children }])).toBe("none");
    expect(fullCourseAdvice("trial", [{ enrolled: 20, maxCapacity: 20, ...children }])).toBe("none");
    expect(fullCourseAdvice("waitlist", [{ enrolled: 20, maxCapacity: 20, ...children }])).toBe("none");
    expect(fullCourseAdvice("active", [])).toBe("none");
  });

  it("calls a course for children when its age band ends before 18", () => {
    expect(isChildrenCourse({ ageMax: 17 })).toBe(true);
    expect(isChildrenCourse({ ageMax: 18 })).toBe(false);
    expect(isChildrenCourse({ ageMax: null })).toBe(false);
  });
});
