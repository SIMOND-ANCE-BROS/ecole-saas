import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { exclusively } from "./scheduled-task";

/**
 * Two runs of the same scheduled task never overlap (#337): a run started while another one
 * holds the task's lock does nothing, whatever the host's scheduler does.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const first = postgres(url, { max: 2, onnotice: () => {} });
const second = postgres(url, { max: 2, onnotice: () => {} });

afterAll(async () => {
  await Promise.all([first.end(), second.end()]);
});

describe("exclusively", () => {
  it("skips a run of the same task while another one is running, from another connection", async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const running = exclusively(first, "zz-test-task", async () => {
      await blocked;
      return "first";
    });
    // Let the first run take its lock.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await exclusively(second, "zz-test-task", async () => "second")).toEqual({ ran: false });
    // Another task is not blocked.
    expect(await exclusively(second, "zz-other-task", async () => "other")).toEqual({ ran: true, value: "other" });

    release();
    expect(await running).toEqual({ ran: true, value: "first" });
    // Once finished, the lock is free again.
    expect(await exclusively(second, "zz-test-task", async () => "again")).toEqual({ ran: true, value: "again" });
  });

  it("frees the lock when the run throws", async () => {
    await expect(
      exclusively(first, "zz-test-task", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await exclusively(second, "zz-test-task", async () => 1)).toEqual({ ran: true, value: 1 });
  });

  it("leaves the pool usable for the task itself while the lock is held", async () => {
    const r = await exclusively(first, "zz-test-task", async () => {
      const [row] = await first<{ one: number }[]>`SELECT 1 AS one`;
      return row?.one;
    });
    expect(r).toEqual({ ran: true, value: 1 });
  });
});
