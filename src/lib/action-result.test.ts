import { describe, expect, it } from "vitest";
import { notFound, redirect } from "next/navigation";
import { actionResult, NOT_SAVED, notSent, orNotSaved, settle } from "./action-result";

describe("settle", () => {
  it("turns a failed call (lost connection) into a French refusal marked not sent", async () => {
    const r = await settle(() => Promise.reject(new TypeError("Failed to fetch")));

    expect(r).toEqual({ ok: false, message: NOT_SAVED, sent: false });
    expect(notSent(r)).toBe(true);
  });

  it("lets a redirect or a « not found » through", async () => {
    await expect(settle(async () => redirect("/connexion"))).rejects.toThrow();
    await expect(settle(async () => notFound())).rejects.toThrow();
  });

  it("passes a success and a refusal of the action through", async () => {
    expect(await settle(async () => ({ ok: true as const }))).toEqual({ ok: true });

    const refused = await settle(async () => ({ ok: false as const, message: "Cette discipline existe déjà." }));

    expect(refused).toEqual({ ok: false, message: "Cette discipline existe déjà." });
    expect(notSent(refused)).toBe(false);
  });

  it("does not mark a refusal that happens to use the same words as not sent", async () => {
    const refused = await settle(async () => ({ ok: false as const, message: NOT_SAVED }));

    expect(notSent(refused)).toBe(false);
  });
});

describe("actionResult", () => {
  it("drops the database's internal fields", () => {
    expect(actionResult({ ok: true })).toEqual({ ok: true });
    expect(actionResult({ ok: false, message: "Refusé." })).toEqual({ ok: false, message: "Refusé." });
  });
});

describe("orNotSaved", () => {
  it("answers with what `failed` builds when the call fails (lost connection)", async () => {
    const r = await orNotSaved(
      () => Promise.reject<{ message: string | null }>(new TypeError("Failed to fetch")),
      () => ({ message: NOT_SAVED }),
    );

    expect(r).toEqual({ message: NOT_SAVED });
  });

  it("lets a redirect or a « not found » through", async () => {
    const failed = () => ({ message: NOT_SAVED });

    await expect(orNotSaved(async () => redirect("/eleves"), failed)).rejects.toThrow();
    await expect(orNotSaved(async () => notFound(), failed)).rejects.toThrow();
  });

  it("passes the action's own answer through, without calling `failed`", async () => {
    let calls = 0;
    const r = await orNotSaved(
      async () => ({ message: "Ce paiement n’existe plus." }),
      () => {
        calls += 1;
        return { message: NOT_SAVED };
      },
    );

    expect(r).toEqual({ message: "Ce paiement n’existe plus." });
    expect(calls).toBe(0);
  });
});
