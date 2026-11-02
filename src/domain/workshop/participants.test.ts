import { describe, expect, it } from "vitest";
import { oneRowPerStudent } from "../enrollment/lifecycle";
import { SIGNUP_LIST_STATUS, withSignups } from "./participants";

type Row = { id: string; name: string; firstName: string | null; status: "active" | "trial" | "waitlist" | "dropped" };

const row = (id: string, name: string, firstName: string | null, status: Row["status"] = "active"): Row => ({
  id,
  name,
  firstName,
  status,
});
const byId = (r: Row) => r.id;
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("withSignups", () => {
  it("keeps the enrolled students in the order given when nobody is signed up", () => {
    const enrolled = [row("b", "Zzbravo", "Léa"), row("a", "Zzalpha", "Tom")];
    expect(ids(withSignups(enrolled, [], byId))).toEqual(["b", "a"]);
  });

  it("lists two signed-up students of a workshop with nobody enrolled, by last then first name", () => {
    const signedUp = [row("2", "Zzmartin", "Zoé"), row("1", "Zzmartin", "Anna")];
    expect(ids(withSignups([], signedUp, byId))).toEqual(["1", "2"]);
  });

  it("puts signed-up students next to enrolled ones, by last name, accents read the French way", () => {
    const enrolled = [row("e1", "Zzécho", "Léa"), row("e2", "Zzfoxtrot", "Tom")];
    const signedUp = [row("s1", "Zzdelta", "Max"), row("s2", "Zzeta", "Inès")];
    expect(ids(withSignups(enrolled, signedUp, byId))).toEqual(["s1", "e1", "s2", "e2"]);
  });

  it("orders a student without a first name before the same last name with one, then by id", () => {
    const signedUp = [row("b", "Zzsolo", "Léa"), row("c", "Zzsolo", null), row("a", "Zzsolo", null)];
    expect(ids(withSignups([], signedUp, byId))).toEqual(["a", "c", "b"]);
  });

  it("shows a student both on the waitlist and signed up once, as attending", () => {
    const enrolled = [row("x", "Zzdouble", "Eva", "waitlist")];
    const signedUp = [row("x", "Zzdouble", "Eva", SIGNUP_LIST_STATUS)];
    const listed = oneRowPerStudent(withSignups(enrolled, signedUp, byId), (r) => r.id);
    expect(listed).toEqual([row("x", "Zzdouble", "Eva", "active")]);
  });
});
