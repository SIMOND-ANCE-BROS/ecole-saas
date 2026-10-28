import { describe, expect, it, vi } from "vitest";
import { businessesOf, RegistryUnavailable, searchRegistry, toBusiness } from "./registry";

// Fictitious companies only (public repository).
const ZZ_DANSE = {
  siren: "000000001",
  nom_complet: "ZZ DANSE (ZZD)",
  nom_raison_sociale: "ZZ DANSE",
  nature_juridique: "5710",
  etat_administratif: "A",
  siege: {
    siret: "00000000100012",
    adresse: "12 RUE DES ZZ 69100 VILLEURBANNE",
    code_postal: "69100",
    libelle_commune: "VILLEURBANNE",
  },
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fake = (...responses: (Response | Error)[]) => {
  const f = vi.fn<typeof fetch>();
  for (const r of responses) {
    if (r instanceof Error) f.mockRejectedValueOnce(r);
    else f.mockResolvedValueOnce(r);
  }
  return f;
};

describe("toBusiness", () => {
  it("keeps the legal name, the head office and the street without postcode and city", () => {
    expect(toBusiness(ZZ_DANSE)).toEqual({
      legalName: "ZZ DANSE",
      siren: "000000001",
      siret: "00000000100012",
      street: "12 RUE DES ZZ",
      postcode: "69100",
      city: "VILLEURBANNE",
      legalForm: "SAS",
      ceased: false,
    });
  });

  it("flags a closed company and leaves out an unknown legal form", () => {
    const b = toBusiness({ ...ZZ_DANSE, etat_administratif: "C", nature_juridique: "1234" });
    expect(b.ceased).toBe(true);
    expect(b.legalForm).toBeNull();
  });

  it("drops the masked values of a sole trader who refused publication", () => {
    const b = toBusiness({
      siren: "000000002",
      nom_complet: "ZZPRÉNOM ZZNOM",
      nom_raison_sociale: null,
      nature_juridique: "1000",
      etat_administratif: "A",
      siege: { siret: "[ND]", adresse: "[NON-DIFFUSIBLE]", code_postal: "[ND]", libelle_commune: "[ND]" },
    });
    expect(b).toMatchObject({
      legalName: "ZZPRÉNOM ZZNOM",
      siret: null,
      street: null,
      postcode: null,
      city: null,
      legalForm: "Entrepreneur individuel",
    });
  });

  it("falls back to the SIREN when no name is public, and keeps an address it cannot split", () => {
    const b = toBusiness({ siren: "000000003", siege: { adresse: "LIEU-DIT ZZ", code_postal: "69100" } });
    expect(b.legalName).toBe("000000003");
    expect(b.street).toBe("LIEU-DIT ZZ");
  });
});

describe("businessesOf", () => {
  it("refuses a response of another shape", () => {
    expect(() => businessesOf({ resultats: [] })).toThrow(RegistryUnavailable);
  });

  it("leaves out a row of another shape and keeps the others", () => {
    expect(businessesOf({ results: [{ siren: "12" }, ZZ_DANSE, null] }).map((b) => b.siren)).toEqual(["000000001"]);
  });

  it("lists open companies first, in the registry's order", () => {
    const closed = { ...ZZ_DANSE, siren: "000000002", etat_administratif: "C" };
    const other = { ...ZZ_DANSE, siren: "000000003" };
    expect(businessesOf({ results: [closed, ZZ_DANSE, other] }).map((b) => b.siren)).toEqual([
      "000000001",
      "000000003",
      "000000002",
    ]);
  });
});

describe("searchRegistry", () => {
  it("asks for a few results and strips the spaces of a typed SIREN", async () => {
    const f = fake(ok({ results: [ZZ_DANSE] }));
    expect(await searchRegistry("000 000 001", { fetch: f })).toHaveLength(1);
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe("000000001");
    expect(url.searchParams.get("per_page")).toBe("8");
  });

  it("does not try again after a « slow down », and passes on how long to wait", async () => {
    const f = fake(new Response("", { status: 429, headers: { "Retry-After": "12" } }));
    await expect(searchRegistry("zz danse", { fetch: f, pauseMs: 0 })).rejects.toMatchObject({
      reason: "throttled",
      retryAfterMs: 12_000,
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("tries again once after a server error, then gives up, releasing each unread body", async () => {
    const first = new Response("busy", { status: 503 });
    const twice = fake(first, ok({ results: [ZZ_DANSE] }));
    expect(await searchRegistry("zz danse", { fetch: twice, pauseMs: 0 })).toHaveLength(1);
    expect(first.bodyUsed || first.body?.locked).toBeTruthy();

    const always = fake(new Response("", { status: 503 }), new Response("", { status: 503 }));
    await expect(searchRegistry("zz danse", { fetch: always, pauseMs: 0 })).rejects.toMatchObject({
      reason: "status",
    });
    expect(always).toHaveBeenCalledTimes(2);
  });

  it("does not try again after a client error", async () => {
    const f = fake(new Response("", { status: 400 }));
    await expect(searchRegistry("zz", { fetch: f, pauseMs: 0 })).rejects.toMatchObject({ reason: "status" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("gives up at the timeout without trying again", async () => {
    const f = fake(new DOMException("too slow", "TimeoutError"));
    await expect(searchRegistry("zz danse", { fetch: f, pauseMs: 0 })).rejects.toMatchObject({ reason: "timeout" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("passes a timeout signal to fetch", async () => {
    const f = fake(ok({ results: [] }));
    await searchRegistry("zz danse", { fetch: f });
    expect(f.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("counts a body that does not arrive in time as a timeout", async () => {
    const slow = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"results": ['));
        },
      }),
      { status: 200 },
    );
    const f = fake(slow);
    await expect(searchRegistry("zz danse", { fetch: f, timeoutMs: 50 })).rejects.toMatchObject({
      reason: "timeout",
    });
  });

  it("stops when the caller gives up, without trying again", async () => {
    const caller = new AbortController();
    const f = vi.fn<typeof fetch>(async (_url, init) => {
      caller.abort();
      throw init?.signal?.reason ?? new DOMException("aborted", "AbortError");
    });
    await expect(searchRegistry("zz danse", { fetch: f, pauseMs: 0, signal: caller.signal })).rejects.toMatchObject({
      reason: "cancelled",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("does not call the registry for a search already given up", async () => {
    const caller = new AbortController();
    caller.abort();
    const f = fake(ok({ results: [] }));
    await expect(searchRegistry("zz danse", { fetch: f, signal: caller.signal })).rejects.toMatchObject({
      reason: "cancelled",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const f = fake(new Response("<html>", { status: 200 }));
    await expect(searchRegistry("zz danse", { fetch: f })).rejects.toMatchObject({ reason: "format" });
  });

  it("tries again once after a network failure", async () => {
    const f = fake(new TypeError("fetch failed"), new TypeError("fetch failed"));
    await expect(searchRegistry("zz danse", { fetch: f, pauseMs: 0 })).rejects.toMatchObject({ reason: "network" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
