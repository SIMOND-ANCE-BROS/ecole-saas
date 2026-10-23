import { describe, expect, it } from "vitest";
import { displayedName } from "./name";

describe("nomAffiche", () => {
  it("donne prénom puis nom, la raison sociale d’un professionnel, ou le nom seul", () => {
    expect(displayedName({ name: "Lefèvre", firstName: "Zoé", companyName: null })).toBe("Zoé Lefèvre");
    expect(displayedName({ name: "Durand", firstName: "Paul", companyName: "CSE Ateliers" })).toBe("CSE Ateliers");
    expect(displayedName({ name: "Mairie", firstName: null, companyName: null })).toBe("Mairie");
  });
});
