import { describe, expect, it } from "vitest";
import { bearerMatches } from "./bearer";

const SECRET = "zz".repeat(32);

describe("bearerMatches", () => {
  it("accepts the right secret", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses a missing, malformed or wrong header", () => {
    expect(bearerMatches(null, SECRET)).toBe(false);
    expect(bearerMatches("", SECRET)).toBe(false);
    expect(bearerMatches(SECRET, SECRET)).toBe(false);
    expect(bearerMatches(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET} extra`, SECRET)).toBe(false);
  });

  it("refuses everything when the server has no secret or a short one", () => {
    expect(bearerMatches("Bearer ", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer short", "short")).toBe(false);
    // A well-formed header sent with the server's own (too short) secret: still refused.
    const short = "z".repeat(31);
    expect(bearerMatches(`Bearer ${short}`, short)).toBe(false);
    expect(bearerMatches(`Bearer ${short}z`, `${short}z`)).toBe(true);
  });
});
