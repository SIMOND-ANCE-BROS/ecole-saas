import { describe, expect, it } from "vitest";
import {
  PERSONAL_KEYS,
  PLACEHOLDER,
  pseudonymisationCutoff,
  redactEntry,
  redactJson,
  SCHOOL_DATA_TABLES,
  TECHNICAL_KEYS,
  unclassifiedKeys,
} from "./pseudonymise";

describe("redactJson", () => {
  it("replaces the reason of a typed enrollment price, keeps ids and amounts", () => {
    const after = {
      payerId: "p-1",
      studentIds: ["s-1", "s-2"],
      grossPriceCents: 45_000,
      discountCents: 4_500,
      manualPriceCents: 30_000,
      reason: "Zz accord de la direction",
    };
    expect(redactJson("enrollment", after)).toEqual({ ...after, reason: PLACEHOLDER });
  });

  it("replaces the e-mail of an invitation, keeps its role and dates", () => {
    const entry = {
      id: "i-1",
      type: "invitation",
      email: "zz@exemple.test",
      role: "front_desk",
      expiresAt: "2026-01-08T10:00:00.000Z",
    };
    expect(redactJson("invitation", entry)).toEqual({ ...entry, email: PLACEHOLDER });
  });

  it("replaces both reason keys of a workshop sign-up (insert and delete entries)", () => {
    expect(redactJson("workshop_signup", { reason: "Zz", unitPriceCents: 0 })).toEqual({
      reason: PLACEHOLDER,
      unitPriceCents: 0,
    });
    expect(redactJson("workshop_signup", { priceReason: "Zz", payerId: "p" })).toEqual({
      priceReason: PLACEHOLDER,
      payerId: "p",
    });
  });

  it("never touches a table without personal keys, even a key named like one", () => {
    const payment = { montant_centimes: 12_000, method: "cheque", reason: "Zz" };
    expect(redactJson("payment", payment)).toEqual(payment);
  });

  it("leaves a null personal value null, and non-string values as they are", () => {
    expect(redactJson("enrollment", { reason: null, grossPriceCents: 1 })).toEqual({
      reason: null,
      grossPriceCents: 1,
    });
    expect(redactJson("enrollment", { reason: 42 })).toEqual({ reason: 42 });
  });

  it("returns null, arrays and scalars unchanged", () => {
    expect(redactJson("enrollment", null)).toBeNull();
    expect(redactJson("enrollment", ["reason"])).toEqual(["reason"]);
    expect(redactJson("enrollment", "reason")).toBe("reason");
  });

  it("does not match inherited keys of the list", () => {
    expect(redactJson("constructor", { toString: "x" })).toEqual({ toString: "x" });
  });
});

describe("redactEntry", () => {
  it("redacts before and after, keeps the rest of the entry", () => {
    const entry = {
      id: 7,
      targetTable: "enrollment",
      before: { status: "trial", manualPriceCents: 100, reason: "Zz avant" },
      after: { status: "active", manualPriceCents: 100, reason: "Zz après" },
    };
    expect(redactEntry(entry)).toEqual({
      id: 7,
      targetTable: "enrollment",
      before: { status: "trial", manualPriceCents: 100, reason: PLACEHOLDER },
      after: { status: "active", manualPriceCents: 100, reason: PLACEHOLDER },
    });
  });

  it("is idempotent", () => {
    const entry = { targetTable: "lesson_pack", before: null, after: { reason: "Zz", priceCents: 5 } };
    expect(redactEntry(redactEntry(entry))).toEqual(redactEntry(entry));
  });
});

describe("key lists", () => {
  it("never list a key both personal and technical", () => {
    for (const [table, keys] of Object.entries(PERSONAL_KEYS))
      for (const key of keys) expect(TECHNICAL_KEYS[table] ?? []).not.toContain(key);
  });

  it("never list a table of school data with a personal key", () => {
    for (const table of Object.keys(PERSONAL_KEYS)) expect(SCHOOL_DATA_TABLES).not.toContain(table);
  });

  it("never make a money key personal", () => {
    for (const keys of Object.values(PERSONAL_KEYS))
      for (const key of keys) expect(key).not.toMatch(/cents|Cents|centimes|amount|method|date|Date|Id$|Ids$/);
  });
});

describe("unclassifiedKeys", () => {
  it("reports a key no list knows, and a table no list knows", () => {
    expect(
      unclassifiedKeys([
        { targetTable: "enrollment", key: "reason" },
        { targetTable: "enrollment", key: "grossPriceCents" },
        { targetTable: "enrollment", key: "phone" },
        { targetTable: "payment", key: "anything" },
        { targetTable: "new_table", key: "x" },
        { targetTable: "new_table", key: "y" },
      ]),
    ).toEqual(["enrollment.phone", "new_table.*"]);
  });

  it("reports nothing for keys of a school-data table, nor for listed keys", () => {
    expect(
      unclassifiedKeys([
        { targetTable: "invoice", key: "total_incl_tax_cents" },
        { targetTable: "invitation", key: "email" },
        { targetTable: "invitation", key: "expiresAt" },
      ]),
    ).toEqual([]);
  });
});

describe("pseudonymisationCutoff", () => {
  it("is three years before today", () => {
    expect(pseudonymisationCutoff("2026-11-16")).toBe("2023-11-16");
  });

  it("falls back to 28 February from a 29 February", () => {
    expect(pseudonymisationCutoff("2028-02-29")).toBe("2025-02-28");
  });

  it("keeps the day otherwise, 28 February and month ends included", () => {
    expect(pseudonymisationCutoff("2027-02-28")).toBe("2024-02-28");
    expect(pseudonymisationCutoff("2027-01-01")).toBe("2024-01-01");
    expect(pseudonymisationCutoff("2026-12-31")).toBe("2023-12-31");
  });
});
