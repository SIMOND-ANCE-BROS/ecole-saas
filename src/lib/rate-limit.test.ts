import { describe, expect, it } from "vitest";
import { Breaker, KeyedBuckets, TokenBucket } from "./rate-limit";

describe("TokenBucket", () => {
  it("allows a burst up to its capacity, then refills at its rate", () => {
    const b = new TokenBucket(3, 1, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(500)).toBe(false);
    expect(b.take(1000)).toBe(true);
    expect(b.take(1000)).toBe(false);
  });

  it("never stores more than its capacity", () => {
    const b = new TokenBucket(2, 1, 0);
    const taken = [0, 0, 0].map(() => b.take(60_000));
    expect(taken).toEqual([true, true, false]);
  });

  it("is idle once full again", () => {
    const b = new TokenBucket(2, 1, 0);
    b.take(0);
    expect(b.idle(500)).toBe(false);
    expect(b.idle(1000)).toBe(true);
  });
});

describe("Breaker", () => {
  it("stays open for the time asked, the longest pause winning", () => {
    const k = new Breaker();
    expect(k.isOpen(0)).toBe(false);
    k.open(0, 30_000);
    k.open(1000, 5000);
    expect(k.isOpen(29_999)).toBe(true);
    expect(k.isOpen(30_000)).toBe(false);
  });
});

describe("KeyedBuckets", () => {
  it("gives each key its own budget", () => {
    const m = new KeyedBuckets(1, 1);
    expect(m.take("a", 0)).toBe(true);
    expect(m.take("a", 0)).toBe(false);
    expect(m.take("b", 0)).toBe(true);
  });
});
