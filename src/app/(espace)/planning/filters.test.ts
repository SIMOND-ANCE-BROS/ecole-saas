import { describe, expect, it } from "vitest";
import type { ScheduleCourse } from "@/db/schedule";
import { EMPTY_FILTERS, filterSchedule } from "./filters";

const base: ScheduleCourse = {
  id: "cours-1",
  weekday: 1,
  startTime: "18:00",
  durationMinutes: 60,
  disciplineId: "jazz",
  discipline: "Jazz",
  roomId: "salle-centre",
  room: "Salle 1",
  siteId: "site-centre",
  site: "Centre",
  recurrence: "hebdomadaire",
  startDate: null,
  endDate: null,
  dates: [],
  instructorId: "prof-1",
  instructor: "Intervenant fictif",
  ageMin: null,
  ageMax: null,
  level: null,
  maxCapacity: 20,
  enrolled: 12,
};
const courses = [
  base,
  { ...base, id: "cours-2", site: "Annexe", roomId: "salle-annexe", instructorId: "prof-2" },
  { ...base, id: "cours-3", discipline: "Classique", instructorId: "prof-2" },
];

describe("filtres du planning", () => {
  it("distingue les salles de même nom sur deux sites", () => {
    expect(filterSchedule(courses, { ...EMPTY_FILTERS, roomId: "salle-annexe" }).map((c) => c.id)).toEqual(["cours-2"]);
  });
  it("combine site, salle, discipline et intervenant", () => {
    expect(
      filterSchedule(courses, {
        site: "Centre",
        roomId: "salle-centre",
        discipline: "Classique",
        instructorId: "prof-2",
      }).map((c) => c.id),
    ).toEqual(["cours-3"]);
  });
  it("renvoie une liste vide pour des filtres incompatibles", () => {
    expect(filterSchedule(courses, { ...EMPTY_FILTERS, site: "Centre", roomId: "salle-annexe" })).toEqual([]);
  });
  it("retrouve tous les cours à la remise à zéro sans modifier la liste", () => {
    expect(filterSchedule(courses, EMPTY_FILTERS)).toEqual(courses);
    expect(courses).toHaveLength(3);
  });
});
