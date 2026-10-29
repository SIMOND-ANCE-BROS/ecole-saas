import { describe, expect, it } from "vitest";
import { statementCsv } from "./statement-csv";
import { IN_FLAT, instructorStatement, type StatementInstructor, type StatementLesson } from "./statement";
import type { RatedInstructor } from "./rate";

const hourly: StatementInstructor = { id: "i1", name: "Alix Test", payMode: "hourly", rateCents: 2500, isOwner: false };
const perLesson: RatedInstructor = { id: "i2", payMode: "per_lesson", rateCents: 3000 };

const lesson = (
  id: string,
  regular: RatedInstructor,
  date: string,
  more: Partial<StatementLesson> = {},
): StatementLesson => ({
  id,
  date,
  startTime: "18:00",
  durationMinutes: 90,
  status: "done",
  instructorId: regular.id,
  courseId: `c-${regular.id}`,
  courseLabel: "Jazz Débutant, lundi 18:00",
  course: { instructorId: regular.id, instructorRateCents: null, instructorRatePayMode: null },
  regular,
  attendance: { taken: true, present: 4 },
  ...more,
});

const statementOf = (instructor: StatementInstructor, lessons: StatementLesson[], rateChanges: string[] = []) =>
  instructorStatement({
    month: "2027-10",
    today: "2027-11-15",
    instructor,
    lessons,
    rateChanges: rateChanges.map((date) => ({ instructorId: instructor.id, date })),
    closures: [],
  });

const rowsOf = (csv: string) => csv.slice(1).split("\r\n").slice(0, -1);

describe("statementCsv", () => {
  it("starts with a BOM and French headers, one row per lesson, amounts with a comma", () => {
    const csv = statementCsv([statementOf(hourly, [lesson("a", hourly, "2027-10-04")])]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(rowsOf(csv)).toEqual([
      "Intervenant;Date;Heure;Cours;Durée (min);Taux;Unité;Montant;Remarque",
      "Alix Test;04/10/2027;18:00;Jazz Débutant, lundi 18:00;90;25,00;heure;37,50;",
    ]);
  });

  it("writes a replacement in the regular teacher's unit, and a lesson without attendance", () => {
    const replaced = lesson("a", perLesson, "2027-10-05", {
      instructorId: "i1",
      status: "planned",
      attendance: { taken: false, present: 0 },
    });
    const rows = rowsOf(statementCsv([statementOf(hourly, [replaced])]));
    expect(rows[1]).toBe(
      "Alix Test;05/10/2027;18:00;Jazz Débutant, lundi 18:00;90;30,00;séance;30,00;remplacement, au tarif du cours, appel non fait",
    );
    expect(rows[2]).toMatch(/^Alix Test;;;À vérifier;;;;;Appel non fait pour certaines séances/);
  });

  it("leaves a lesson to price without an amount, with the reason", () => {
    const old = lesson("a", hourly, "2027-10-05", {
      course: { instructorId: "i1", instructorRateCents: 4000, instructorRatePayMode: "per_lesson" },
    });
    expect(rowsOf(statementCsv([statementOf(hourly, [old])]))[1]).toBe(
      "Alix Test;05/10/2027;18:00;Jazz Débutant, lundi 18:00;90;;;;à chiffrer — tarif du cours saisi dans un ancien mode de rémunération",
    );
  });

  it("adds the monthly flat row and the flags; the amount column adds up to the amount due", () => {
    const flat: StatementInstructor = {
      id: "i3",
      name: "Marin Test",
      payMode: "monthly_flat",
      rateCents: 80000,
      isOwner: false,
    };
    const s = statementOf(flat, [lesson("a", flat, "2027-10-04")], ["2027-10-10"]);
    const rows = rowsOf(statementCsv([s]));
    expect(rows[1]).toBe(`Marin Test;04/10/2027;18:00;Jazz Débutant, lundi 18:00;90;;;;${IN_FLAT}`);
    expect(rows[2]).toBe("Marin Test;;;Forfait mensuel;;800,00;mois;800,00;");
    expect(rows[3]).toMatch(/^Marin Test;;;À vérifier;;;;;Un tarif ou le mode de rémunération a changé/);
    const amounts = rows.slice(1).map((r) => r.split(";")[7]);
    expect(amounts.filter(Boolean)).toEqual(["800,00"]);
  });

  it("never lets a name or label be read as a formula", () => {
    const csv = statementCsv([
      statementOf({ ...hourly, name: "=HYPERLINK(1)" }, [lesson("a", hourly, "2027-10-04", { courseLabel: "a;b" })]),
    ]);
    expect(rowsOf(csv)[1]).toBe(`'=HYPERLINK(1);04/10/2027;18:00;"a;b";90;25,00;heure;37,50;`);
  });

  it("writes only the header for an empty month", () => {
    expect(rowsOf(statementCsv([]))).toHaveLength(1);
  });
});
