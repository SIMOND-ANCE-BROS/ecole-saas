import { afterEach, describe, expect, it, vi } from "vitest";
import { deferredQuery } from "./deferred-query";

afterEach(() => vi.useRealTimers());
const promise = <T>() => {
  let resolveIt!: (value: T) => void;
  let rejectIt!: (error: Error) => void;
  const pending = new Promise<T>((resolve, reject) => {
    resolveIt = resolve;
    rejectIt = reject;
  });
  return { pending, resolve: resolveIt, reject: rejectIt };
};

describe("deferred preview tied to the current input", () => {
  it("does not run a computation cancelled while typing", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 100);
    const cancel = deferredQuery(load, vi.fn(), vi.fn());
    cancel();
    await vi.runAllTimersAsync();
    expect(load).not.toHaveBeenCalled();
  });

  it("ignores an old response arriving after the new price", async () => {
    vi.useFakeTimers();
    const old = promise<number>();
    const next = promise<number>();
    const display = vi.fn();
    const cancel = deferredQuery(() => old.pending, display, vi.fn());
    await vi.advanceTimersByTimeAsync(150);
    cancel();
    deferredQuery(() => next.pending, display, vi.fn());
    await vi.advanceTimersByTimeAsync(150);
    next.resolve(16500);
    await vi.runAllTimersAsync();
    old.resolve(9500);
    await vi.runAllTimersAsync();
    expect(display.mock.calls).toEqual([[16500]]);
  });

  it("reports a failure to offer a retry", async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    deferredQuery(
      async () => {
        throw new Error("indisponible");
      },
      vi.fn(),
      error,
    );
    await vi.runAllTimersAsync();
    expect(error).toHaveBeenCalledOnce();
  });

  it("ignores a failure after the input changed or the page was left", async () => {
    vi.useFakeTimers();
    const old = promise<number>();
    const error = vi.fn();
    const cancel = deferredQuery(() => old.pending, vi.fn(), error);
    await vi.advanceTimersByTimeAsync(150);
    cancel();
    old.reject(new Error("ancienne requête"));
    await vi.runAllTimersAsync();
    expect(error).not.toHaveBeenCalled();
  });
});
