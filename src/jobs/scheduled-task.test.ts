import { describe, expect, it } from "vitest";
import { EXIT_CODE, errorLabel, exitCodeOf } from "./scheduled-task";

describe("errorLabel", () => {
  it("keeps the class name and the technical code, never the message", () => {
    const e = Object.assign(new Error("duplicate key: Key (email)=(zz@example.org) already exists"), {
      name: "PostgresError",
      code: "23505",
    });
    expect(errorLabel(e)).toBe("PostgresError 23505");
    expect(errorLabel(new TypeError("Zz Zz is not a function"))).toBe("TypeError");
  });

  it("ignores a code that is not a short technical token", () => {
    expect(errorLabel(Object.assign(new Error("x"), { code: 42 }))).toBe("Error");
    expect(errorLabel(Object.assign(new Error("x"), { code: "Zz Zz, 3 rue des Zz" }))).toBe("Error");
  });

  it("labels what is not an Error without printing it", () => {
    expect(errorLabel("Zz Zz")).toBe("unknown error");
    expect(errorLabel(undefined)).toBe("unknown error");
  });
});

describe("exitCodeOf", () => {
  it("fails the run when any unit failed, so that the scheduler alerts", () => {
    expect(exitCodeOf({ summary: "", failures: 0 })).toBe(EXIT_CODE.ok);
    expect(exitCodeOf({ summary: "", failures: 1 })).toBe(EXIT_CODE.failed);
  });

  it("uses distinct codes for success, failure and timeout", () => {
    expect(new Set(Object.values(EXIT_CODE)).size).toBe(Object.keys(EXIT_CODE).length);
    expect(EXIT_CODE.ok).toBe(0);
  });
});
