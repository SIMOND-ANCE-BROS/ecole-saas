import { beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks what the settings actions accept (#243).
const requireRole = vi.fn();
vi.mock("@/lib/session", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The real schemas (Vitest has no `@/` alias here); the writes never run, `withSchool` is stubbed.
vi.mock("@/db/settings", () => import("../../../db/settings"));
vi.mock("@/db/tariffs", () => import("../../../db/tariffs"));
vi.mock("@/db/lessons", () => ({ syncRoomSeasons: vi.fn() }));
vi.mock("@/domain/people/age", () => import("../../../domain/people/age"));
vi.mock("@/lib/action-result", () => import("../../../lib/action-result"));

const actions = await import("./actions");

const ID = "8d2c6c1e-3f4a-4b5c-9d6e-7f8091a2b3c4";
// Whatever the browser may send, which the types of the call sites never allow.
const any = <T>(v: unknown) => v as T;

beforeEach(() => {
  withSchool.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ schoolId: "school-a", userId: "user-a" });
});

describe("settings actions", () => {
  it("check the role before reading anything", async () => {
    requireRole.mockRejectedValueOnce(new Error("redirect"));

    await expect(actions.removeSite("not-a-uuid")).rejects.toThrow("redirect");
    expect(requireRole).toHaveBeenCalledWith("director");
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuse an unknown id with the record's own message, without touching the database", async () => {
    expect(await actions.removeDiscipline("x")).toEqual({ ok: false, message: "Cette discipline n’existe plus." });
    expect(await actions.removeSite("x")).toEqual({ ok: false, message: "Ce site n’existe plus." });
    expect(await actions.removeRoom("x")).toEqual({ ok: false, message: "Cette salle n’existe plus." });
    expect(await actions.removeLessonPack("x")).toEqual({ ok: false, message: "Ce carnet n’existe plus." });
    expect(
      await actions.changeSeason("x", { label: "2027-2028", startDate: "2027-09-01", endDate: "2028-06-30" }),
    ).toEqual({ ok: false, message: "Cette saison n’existe plus." });
    expect(await actions.siblingsRule("x", null)).toEqual({ ok: false, message: "Saison introuvable." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuse an invalid entry with the schema's French message", async () => {
    expect(await actions.newSeason({ label: "", startDate: "2027-09-01", endDate: "2028-06-30" }, null)).toEqual({
      ok: false,
      message: "Libellé obligatoire",
    });
    expect(await actions.newSeason({ label: "2027", startDate: "2028-06-30", endDate: "2027-09-01" }, null)).toEqual({
      ok: false,
      message: "La fin doit suivre le début.",
    });
    expect(await actions.newSite({ name: "Centre", address: " ", permanence: false })).toEqual({
      ok: false,
      message: "Adresse obligatoire",
    });
    expect(await actions.changeHours(ID, [{ weekday: 1, opening: "18:00", closure: "09:00" }])).toEqual({
      ok: false,
      message: "L’heure de fermeture doit suivre l’ouverture.",
    });
    expect(await actions.newDiscipline(any<string>(null))).toEqual({ ok: false, message: "Nom obligatoire" });
    expect(
      await actions.newSeason({ label: "2027-2028", startDate: "2027-09-01", endDate: "2028-06-30" }, "not-a-uuid"),
    ).toEqual({ ok: false, message: "Saison de référence introuvable." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuse a siblings rule with both a rate and an amount", async () => {
    const r = await actions.siblingsRule(ID, {
      rateBps: 1000,
      amountCents: 500,
      minStudents: 2,
      audiences: [],
      combinableWithMultiDiscipline: false,
    });

    expect(r).toEqual({ ok: false, message: "Indiquez un pourcentage ou un montant, pas les deux." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("let removing the siblings rule (null) through", async () => {
    withSchool.mockResolvedValueOnce({ ok: true, id: ID });

    expect(await actions.siblingsRule(ID, null)).toEqual({ ok: true });
  });

  it("return { ok: true } without the database's internal fields", async () => {
    withSchool.mockResolvedValueOnce({ ok: true, id: ID });

    expect(await actions.newRoom({ siteId: ID, name: "Salle 1", capacity: null })).toEqual({ ok: true });
  });

  it("pass the refusal message of the database layer through", async () => {
    withSchool.mockResolvedValueOnce({ ok: false, message: "Cette discipline existe déjà." });

    expect(await actions.newDiscipline("Jazz")).toEqual({ ok: false, message: "Cette discipline existe déjà." });
  });

  it("note the lessons a season edit leaves outside its new dates (#270)", async () => {
    const entry = { label: "2027-2028", startDate: "2027-09-01", endDate: "2028-06-30" };
    withSchool.mockResolvedValueOnce({ ok: true, id: ID, outside: 0 });
    expect(await actions.changeSeason(ID, entry)).toEqual({ ok: true, note: null });

    withSchool.mockResolvedValueOnce({ ok: true, id: ID, outside: 1 });
    expect(await actions.changeSeason(ID, entry)).toEqual({
      ok: true,
      note: "1 séance reste en dehors des nouvelles dates (déjà faite, avec carnet ou déplacée) : déplacez-la ou annulez-la dans le planning si besoin.",
    });

    withSchool.mockResolvedValueOnce({ ok: true, id: ID, outside: 3 });
    const r = await actions.changeSeason(ID, entry);
    expect(r.ok && r.note).toMatch(/^3 séances restent en dehors des nouvelles dates/);
  });
});
