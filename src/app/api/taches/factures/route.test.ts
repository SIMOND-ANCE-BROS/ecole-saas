import { afterEach, describe, expect, it, vi } from "vitest";

const sweep = vi.fn(async () => ({ pairs: 0, failedPairs: 0 }));
vi.mock("../../../../jobs/invoicing/send", () => ({ sweep }));

const { POST } = await import("./route");

const SECRET = "zz".repeat(32);
const call = (authorization?: string) =>
  POST(
    new Request("http://localhost/api/taches/factures", {
      method: "POST",
      headers: authorization === undefined ? {} : { authorization },
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  sweep.mockClear();
});

describe("POST /api/taches/factures", () => {
  it("refuses a missing or wrong secret without running the sweep", async () => {
    vi.stubEnv("JOBS_SECRET", SECRET);
    for (const header of [undefined, "", `Bearer ${SECRET}x`, `Bearer ${"zy".repeat(32)}`, SECRET]) {
      const response = await call(header);
      expect(response.status).toBe(401);
    }
    expect(sweep).not.toHaveBeenCalled();
  });

  it("refuses everything when the server has no secret", async () => {
    vi.stubEnv("JOBS_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    vi.stubEnv("JOBS_SECRET", "short");
    expect((await call("Bearer short")).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it("runs the sweep with the right secret and answers counts only", async () => {
    vi.stubEnv("JOBS_SECRET", SECRET);
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ pairs: 0, failedPairs: 0 });
    expect(sweep).toHaveBeenCalledOnce();
  });

  it("answers an error status when a business failed, so that the scheduler alerts (#337)", async () => {
    vi.stubEnv("JOBS_SECRET", SECRET);
    sweep.mockResolvedValueOnce({ pairs: 2, failedPairs: 1 });
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ pairs: 2, failedPairs: 1 });
  });
});
