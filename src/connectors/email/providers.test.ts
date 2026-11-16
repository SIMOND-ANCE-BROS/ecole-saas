import { describe, expect, it, vi } from "vitest";
import { BREVO_URL, RESEND_URL, brevoSender, providerSender, resendSender } from "./providers";

const CONFIG = { apiKey: "key-test-0001", fromAddress: "ecole@exemple.test", fromName: "École Test" };
const MESSAGE = { to: "zz@exemple.test", subject: "Objet", text: "Bonjour" };
const FAST = { pauseMs: 0, timeoutMs: 50 };

const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A fetch answering each call in turn, recording what it was asked. */
function scripted(...answers: (Response | Error | "hang")[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next === "hang") return new Promise<Response>(() => {});
    if (next instanceof Error) throw next;
    return next.clone();
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls };
}

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>;
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe.each([
  ["brevo", brevoSender],
  ["resend", resendSender],
] as const)("%s sender", (_name, build) => {
  it("succeeds on a 2xx answer, in one call", async () => {
    const f = scripted(json(201, { messageId: "<id@relay>" }));
    expect(await build(CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE)).toEqual({ ok: true });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].init.method).toBe("POST");
  });

  it("does not retry a 4xx: fails as refused, with the status and the provider's code", async () => {
    const f = scripted(json(401, { code: "unauthorized", message: "Key not found" }));
    expect(await build(CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE)).toEqual({
      ok: false,
      reason: "refused",
      status: 401,
      code: "unauthorized",
    });
    expect(f.calls).toHaveLength(1);
  });

  it("retries a 5xx once, then fails as unavailable", async () => {
    const f = scripted(json(502), json(503));
    expect(await build(CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE)).toEqual({
      ok: false,
      reason: "unavailable",
      status: 503,
    });
    expect(f.calls).toHaveLength(2);
  });

  it("a 5xx then a success is a success", async () => {
    const f = scripted(json(500), json(200, { id: "x" }));
    expect(await build(CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE)).toEqual({ ok: true });
    expect(f.calls).toHaveLength(2);
  });

  it("retries a timeout once, even when fetch ignores its signal, then fails as timeout", async () => {
    const f = scripted("hang");
    expect(await build(CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE)).toEqual({ ok: false, reason: "timeout" });
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries a network error once, then fails as unavailable", async () => {
    const f = scripted(new TypeError("fetch failed"));
    expect(await build(CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(f.calls).toHaveLength(2);
  });

  it("retries a 429 asking a short wait, not one asking a long wait", async () => {
    const short = scripted(json(429, {}, { "retry-after": "0" }), json(200));
    expect(await build(CONFIG, { ...FAST, fetch: short.fetch }).send(MESSAGE)).toEqual({ ok: true });
    expect(short.calls).toHaveLength(2);
    const long = scripted(json(429, {}, { "retry-after": "60" }));
    expect(await build(CONFIG, { ...FAST, fetch: long.fetch }).send(MESSAGE)).toMatchObject({
      ok: false,
      reason: "unavailable",
      status: 429,
    });
    expect(long.calls).toHaveLength(1);
  });

  it("never puts the address, subject or body in the failure", async () => {
    const f = scripted(json(400, { code: "invalid_parameter", message: `bad address ${MESSAGE.to}` }));
    const r = await build(CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE);
    expect(JSON.stringify(r)).not.toContain(MESSAGE.to);
    expect(JSON.stringify(r)).not.toContain("bad address");
  });

  it("drops a provider code that does not look like a code", async () => {
    const f = scripted(json(422, { name: "zz@exemple.test is invalid" }));
    expect(await build(CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE)).toEqual({
      ok: false,
      reason: "refused",
      status: 422,
    });
  });
});

describe("request shapes", () => {
  it("Brevo: api-key header, sender, recipient and plain text", async () => {
    const f = scripted(json(201));
    await brevoSender(CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE);
    expect(f.calls[0].url).toBe(BREVO_URL);
    expect(headersOf(f.calls[0].init)["api-key"]).toBe(CONFIG.apiKey);
    expect(bodyOf(f.calls[0].init)).toEqual({
      sender: { email: CONFIG.fromAddress, name: CONFIG.fromName },
      to: [{ email: MESSAGE.to }],
      subject: MESSAGE.subject,
      textContent: MESSAGE.text,
    });
  });

  it("Resend: bearer key, quoted from, the same idempotency key on the retry", async () => {
    const f = scripted(json(500), json(200));
    await resendSender({ ...CONFIG, fromName: 'École "Test"\r\nBcc: x' }, { ...FAST, fetch: f.fetch }).send(MESSAGE);
    expect(f.calls[0].url).toBe(RESEND_URL);
    const headers = headersOf(f.calls[0].init);
    expect(headers.authorization).toBe(`Bearer ${CONFIG.apiKey}`);
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headersOf(f.calls[1].init)["idempotency-key"]).toBe(headers["idempotency-key"]);
    expect(bodyOf(f.calls[0].init)).toEqual({
      from: `"École TestBcc: x" <${CONFIG.fromAddress}>`,
      to: [MESSAGE.to],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    });
  });

  it("Resend: two messages, two idempotency keys", async () => {
    const f = scripted(json(200));
    const sender = resendSender(CONFIG, { ...FAST, fetch: f.fetch });
    await sender.send(MESSAGE);
    await sender.send(MESSAGE);
    expect(headersOf(f.calls[0].init)["idempotency-key"]).not.toBe(headersOf(f.calls[1].init)["idempotency-key"]);
  });

  it("providerSender picks the provider", async () => {
    const f = scripted(json(200));
    await providerSender("resend", CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE);
    await providerSender("brevo", CONFIG, { ...FAST, fetch: f.fetch }).send(MESSAGE);
    expect(f.calls.map((c) => c.url)).toEqual([RESEND_URL, BREVO_URL]);
  });
});
