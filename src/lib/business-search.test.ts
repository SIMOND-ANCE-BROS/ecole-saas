import { describe, expect, it, vi } from "vitest";
import { type Business, RegistryUnavailable } from "../connectors/business-registry/registry";
import { createBusinessSearch, UNAVAILABLE } from "./business-search";

// Fictitious company only (public repository).
const ZZ: Business = {
  legalName: "ZZ DANSE",
  siren: "000000001",
  siret: null,
  street: null,
  postcode: null,
  city: null,
  legalForm: null,
  ceased: false,
};
const A = { schoolId: "school-a", userId: "user-a" };

function setup() {
  let t = 0;
  const search = vi.fn(async (_q: string): Promise<Business[]> => [ZZ]);
  const find = createBusinessSearch({ search, now: () => t });
  return { find, search, at: (ms: number) => (t = ms) };
}

describe("createBusinessSearch", () => {
  it("serves the same query again from the cache, spaces of a SIREN ignored", async () => {
    const { find, search } = setup();
    expect(await find(A, "000 000 001")).toEqual({ ok: true, results: [ZZ] });
    expect(await find(A, "000000001")).toEqual({ ok: true, results: [ZZ] });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("does not share the cache between schools", async () => {
    const { find, search } = setup();
    await find(A, "zz danse");
    await find({ schoolId: "school-b", userId: "user-b" }, "zz danse");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("limits each member to a small burst, then about one search per second", async () => {
    const { find, search, at } = setup();
    for (const q of ["zz a", "zz b", "zz c"]) expect((await find(A, q)).ok).toBe(true);
    expect(await find(A, "zz d")).toEqual({ ok: false, message: UNAVAILABLE });
    at(1000);
    expect((await find(A, "zz e")).ok).toBe(true);
    expect(search).toHaveBeenCalledTimes(4);
  });

  it("limits the whole server, all members together", async () => {
    const { find, search } = setup();
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push((await find({ schoolId: "s", userId: `u${i}` }, `zz ${i}`)).ok);
    expect(answers).toEqual([true, true, true, true, true, false]);
    expect(search).toHaveBeenCalledTimes(5);
  });

  it("stops every search after a « slow down », for the time the registry asks", async () => {
    const { find, search, at } = setup();
    search.mockRejectedValueOnce(new RegistryUnavailable("throttled", 10_000));
    expect((await find(A, "zz a")).ok).toBe(false);
    at(5000);
    expect((await find({ schoolId: "s", userId: "other" }, "zz b")).ok).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
    at(10_000);
    expect((await find(A, "zz c")).ok).toBe(true);
  });

  it("pauses 30 seconds when the registry does not say how long", async () => {
    const { find, search, at } = setup();
    search.mockRejectedValueOnce(new RegistryUnavailable("throttled"));
    await find(A, "zz a");
    at(29_999);
    expect((await find(A, "zz b")).ok).toBe(false);
    at(30_000);
    expect((await find(A, "zz c")).ok).toBe(true);
  });

  it("does not pause after another failure", async () => {
    const { find, search, at } = setup();
    search.mockRejectedValueOnce(new RegistryUnavailable("status"));
    expect(await find(A, "zz a")).toEqual({ ok: false, message: UNAVAILABLE });
    at(1000);
    expect((await find(A, "zz b")).ok).toBe(true);
  });
});
