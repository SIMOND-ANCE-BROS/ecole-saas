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

describe("aperçu différé lié à la saisie courante", () => {
  it("ne lance pas un calcul annulé pendant la frappe", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 100);
    const cancel = deferredQuery(load, vi.fn(), vi.fn());
    cancel();
    await vi.runAllTimersAsync();
    expect(load).not.toHaveBeenCalled();
  });

  it("ignore une ancienne réponse arrivée après le nouveau prix", async () => {
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

  it("signale un échec pour proposer une nouvelle tentative", async () => {
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

  it("ignore un échec après changement de saisie ou départ de la page", async () => {
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
