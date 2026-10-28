import { describe, expect, it } from "vitest";
import { isRememberedList, listAddress, listReturn } from "./list-return";

describe("listReturn", () => {
  it("goes back to the list with its filters and sort", () => {
    expect(listReturn("/eleves", "/eleves?f=age.inf.12&sort=nom&order=desc")).toBe(
      "/eleves?f=age.inf.12&sort=nom&order=desc",
    );
  });

  it("falls back to the bare list when nothing is stored", () => {
    expect(listReturn("/contacts", null)).toBe("/contacts");
    expect(listReturn("/contacts", "")).toBe("/contacts");
    expect(listReturn("/contacts", "/contacts")).toBe("/contacts");
  });

  it("never leads elsewhere: other list, other path, other origin", () => {
    const refused = [
      "/contacts?q=a",
      "/eleves/123",
      "/elevesX?q=a",
      "https://exemple.test/eleves?q=a",
      "//exemple.test/eleves?q=a",
      "/eleves?q=a#x",
      "/eleves?q=a\\@exemple.test",
      "/eleves?q=a b",
      `/eleves?q=${"a".repeat(2001)}`,
    ];
    expect(refused.map((s) => listReturn("/eleves", s))).toEqual(refused.map(() => "/eleves"));
  });
});

describe("isRememberedList", () => {
  it("knows the lists only", () => {
    expect(["/eleves", "/contacts", "/intervenants", "/eleves/1", "/planning"].map(isRememberedList)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("listAddress", () => {
  it("keeps search, filters, mode and sort", () => {
    expect(listAddress("/eleves", "q=Ma&f=age.inf.12&f=cours.contient.Jazz&mode=ou&sort=nom&order=desc")).toBe(
      "/eleves?q=Ma&f=age.inf.12&f=cours.contient.Jazz&mode=ou&sort=nom&order=desc",
    );
  });

  it("keeps the page, so the way back lands on the same rows", () => {
    expect(listAddress("/contacts", "q=Ma&page=3&enregistre=abc")).toBe("/contacts?q=Ma&page=3");
  });

  it("drops one-shot banners and unknown parameters", () => {
    expect(listAddress("/intervenants", "enregistre=abc&sort=nom&supprime=1&autre=x")).toBe("/intervenants?sort=nom");
    expect(listAddress("/intervenants", "enregistre=abc")).toBe("/intervenants");
    expect(listAddress("/contacts", "")).toBe("/contacts");
  });
});
