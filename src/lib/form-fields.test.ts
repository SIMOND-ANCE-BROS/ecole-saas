import { describe, expect, it } from "vitest";
import { formFields } from "./form-fields";

describe("formFields", () => {
  it("reads a text value, empty when the field is absent", () => {
    const f = formFields("email", "password");
    const d = new FormData();
    d.set("email", "a@exemple.test");
    expect([f.read(d, "email"), f.read(d, "password"), f.name("email")]).toEqual(["a@exemple.test", "", "email"]);
  });

  it("reads every field at once, with an empty value for a missing one and nothing else", () => {
    const f = formFields("firstName", "name", "active");
    const d = new FormData();
    d.set("firstName", "Zzmia");
    d.set("active", "on");
    d.set("other", "ignored");

    expect(f.readAll(d)).toEqual({ firstName: "Zzmia", name: "", active: "on" });
  });
});
