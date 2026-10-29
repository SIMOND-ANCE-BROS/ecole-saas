import { beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks who may act and what the actions accept (#287).
const requireRole = vi.fn();
vi.mock("@/lib/session", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/student-documents", () => import("../../../../db/student-documents"));
vi.mock("@/domain/people/documents", () => import("../../../../domain/people/documents"));
vi.mock("@/domain/people/age", () => import("../../../../domain/people/age"));
vi.mock("@/lib/action-result", () => import("../../../../lib/action-result"));

const actions = await import("./document-actions");

const ID = "8d2c6c1e-3f4a-4b5c-9d6e-7f8091a2b3c4";
// Whatever the browser may send, which the types of the call sites never allow.
const any = <T>(v: unknown) => v as T;

beforeEach(() => {
  withSchool.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ schoolId: "school-a", userId: "user-a", role: "front_desk" });
});

describe("document actions", () => {
  it("are open to the front desk and management, checked before anything else", async () => {
    requireRole.mockRejectedValueOnce(new Error("redirect"));
    await expect(actions.receiveDocumentToday(ID, "medical_certificate")).rejects.toThrow("redirect");
    expect(requireRole).toHaveBeenCalledWith("director", "front_desk");
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuse an unknown student or document type without touching the database", async () => {
    expect(await actions.receiveDocumentToday("x", "medical_certificate")).toEqual({
      ok: false,
      message: "Cet élève n’existe plus.",
    });
    expect(await actions.receiveDocumentToday(ID, any("other"))).toEqual({ ok: false, message: "Document inconnu." });
    expect(await actions.unreceiveDocument(ID, any("passport"))).toEqual({ ok: false, message: "Document inconnu." });
    expect(
      await actions.editDocument("x", {
        type: "image_rights",
        receivedOn: "2026-09-10",
        validUntil: null,
        granted: true,
      }),
    ).toEqual({ ok: false, message: "Cet élève n’existe plus." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("pass a valid request to the database layer of the session's school", async () => {
    withSchool.mockResolvedValueOnce({ ok: true });
    expect(await actions.unreceiveDocument(ID, "image_rights")).toEqual({ ok: true });
    expect(withSchool).toHaveBeenCalledWith("school-a", expect.any(Function));
  });
});
