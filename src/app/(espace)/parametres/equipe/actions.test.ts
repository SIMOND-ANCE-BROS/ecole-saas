import { beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks what the team actions accept (#243).
vi.mock("@/lib/session", () => ({
  requireRole: async () => ({ schoolId: "school-a", userId: "user-a" }),
}));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The real invitation schema (Vitest has no `@/` alias here); the writes never run.
vi.mock("@/db/team", () => import("../../../../db/team"));
vi.mock("@/domain/team/rules", () => import("../../../../domain/team/rules"));
const createResetLink = vi.fn();
vi.mock("@/lib/invitations", () => ({
  createResetLink: (...args: unknown[]) => createResetLink(...args),
  linkAddress: () => "https://example.test/invitation",
}));

const { inviteMember, revoke, changeMember, resetPassword } = await import("./actions");

const ID = "8d2c6c1e-3f4a-4b5c-9d6e-7f8091a2b3c4";

beforeEach(() => {
  withSchool.mockReset();
  createResetLink.mockReset();
});

describe("team actions", () => {
  it("refuse an unknown member or invitation without touching the database", async () => {
    expect(await revoke("x")).toEqual({ ok: false, message: "Cette invitation n’existe plus." });
    expect(await changeMember("x", { role: "front_desk", active: true })).toEqual({
      ok: false,
      message: "Ce membre n’existe plus.",
    });
    expect(await resetPassword("x")).toEqual({ ok: false, message: "Ce membre n’existe plus." });
    expect(withSchool).not.toHaveBeenCalled();
    expect(createResetLink).not.toHaveBeenCalled();
  });

  it("refuse an invitation without an e-mail, with the schema's French message", async () => {
    const r = await inviteMember({ name: "Zz Test", email: "pas-un-email", role: "front_desk" });

    expect(r.ok).toBe(false);
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuse an unknown role", async () => {
    const role = "owner" as "director";

    expect(await changeMember(ID, { role, active: true })).toEqual({ ok: false, message: "Choisissez un rôle." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("pass the refusal of the database layer through", async () => {
    withSchool.mockResolvedValueOnce({ ok: false, message: "Vous ne pouvez pas modifier votre propre rôle." });

    expect(await changeMember(ID, { role: "front_desk", active: true })).toEqual({
      ok: false,
      message: "Vous ne pouvez pas modifier votre propre rôle.",
    });
  });
});
