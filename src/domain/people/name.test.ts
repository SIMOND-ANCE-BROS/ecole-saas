import { describe, expect, it } from "vitest";
import { displayedName } from "./name";

describe("displayedName", () => {
  it("gives first name then last name, a professional's company name, or the name alone", () => {
    expect(displayedName({ name: "Lefèvre", firstName: "Zoé", companyName: null })).toBe("Zoé Lefèvre");
    expect(displayedName({ name: "Durand", firstName: "Paul", companyName: "CSE Ateliers" })).toBe("CSE Ateliers");
    expect(displayedName({ name: "Mairie", firstName: null, companyName: null })).toBe("Mairie");
  });
});
