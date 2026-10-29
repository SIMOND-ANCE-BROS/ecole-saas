import { describe, expect, it } from "vitest";
import { validPersonInput } from "./people";

const entry = (fields: Record<string, string | null>) => ({
  type: "individual",
  name: "",
  firstName: null,
  companyName: null,
  siren: null,
  birthDate: null,
  email: null,
  telephone: null,
  address: null,
  notes: null,
  ...fields,
});

describe("validPersonInput", () => {
  // #216, recommended rule pending the school's validation: « M. Zzdupont » is completed later.
  it("accepts an individual known only by their last name", () => {
    const r = validPersonInput.safeParse(entry({ name: "Zzdupont", firstName: "" }));
    expect(r.success).toBe(true);
    expect(r.data?.firstName).toBeNull();
  });

  it("still requires the last name of an individual", () => {
    const r = validPersonInput.safeParse(entry({ name: " ", firstName: "Zoé" }));
    expect(r.error?.issues).toEqual([expect.objectContaining({ path: ["name"], message: "Nom obligatoire" })]);
  });
});
