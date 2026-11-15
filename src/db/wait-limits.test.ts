import { describe, expect, it } from "vitest";
import { BUSY, orBusy } from "../lib/action-result";
import { waitedTooLong } from "./wait-limits";

/** The driver's error as Drizzle wraps it (`DrizzleQueryError`): the Postgres code is on `cause`. */
const wrapped = (code: string) =>
  Object.assign(new Error("Failed query"), { cause: Object.assign(new Error(), { code }) });

describe("waitedTooLong (#364)", () => {
  it("recognises a lock timeout and a statement timeout, bare or wrapped by Drizzle", () => {
    expect(waitedTooLong({ code: "55P03" })).toBe(true);
    expect(waitedTooLong(wrapped("55P03"))).toBe(true);
    expect(waitedTooLong(wrapped("57014"))).toBe(true);
  });

  it("leaves every other error alone: deadlock, unique violation, plain errors, non-errors", () => {
    expect(waitedTooLong(wrapped("40P01"))).toBe(false);
    expect(waitedTooLong(wrapped("23505"))).toBe(false);
    expect(waitedTooLong(new Error("55P03"))).toBe(false);
    expect(waitedTooLong("57014")).toBe(false);
    expect(waitedTooLong(null)).toBe(false);
    expect(waitedTooLong(undefined)).toBe(false);
  });
});

describe("orBusy (#364)", () => {
  it("turns a timeout into « Réessayez dans un instant. »", async () => {
    await expect(orBusy(() => Promise.reject(wrapped("55P03")))).resolves.toEqual({ ok: false, message: BUSY });
    expect(BUSY).toBe("Réessayez dans un instant.");
  });

  it("builds the answer of another shape with `busy`", async () => {
    const r = await orBusy<{ message: string }>(
      () => Promise.reject(wrapped("57014")),
      (message) => ({ message }),
    );
    expect(r).toEqual({ message: BUSY });
  });

  it("returns the result, and lets any other error through", async () => {
    await expect(orBusy(() => Promise.resolve({ ok: true }))).resolves.toEqual({ ok: true });
    const deadlock = wrapped("40P01");
    await expect(orBusy(() => Promise.reject(deadlock))).rejects.toBe(deadlock);
  });
});
