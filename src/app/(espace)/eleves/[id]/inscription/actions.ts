"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { type Preview, enrollmentPreview, saveEnrollment, validManualPrices } from "@/db/enrollments";
import { currentSeason } from "@/db/schedule";
import { acceptRules, payersRules, setReferralIfNone } from "@/db/internal-rules";
import { once, storedEnrollment } from "@/db/submissions";
import { INITIAL_STATUSES } from "@/domain/enrollment/lifecycle";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";

const validInput = z.object({
  payerId: z.uuid(),
  studentIds: z.array(z.uuid()).max(2),
  audience: z.enum(["child", "adult", "couple", "student"]),
  period: z.enum(["quarter", "year", "single"]),
  courseIds: z.array(z.uuid()).max(10),
  status: z.enum(INITIAL_STATUSES),
});

export type FormInput = z.infer<typeof validInput>;

/**
 * What is saved: the form's input, the prices typed by the front desk, one per business at
 * most (#292), and whether enrolling a student again in a course they take was confirmed (#333).
 */
const validEnrollment = validInput.extend({
  manualPrices: validManualPrices,
  duplicatesConfirmed: z.boolean(),
  // #296: the box « Règlement intérieur signé » ticked at the desk, and the answer to
  // « Comment nous avez-vous connus ? » for the students who have none yet.
  rulesSigned: z.boolean(),
  referralId: z.uuid().nullable(),
});
export type EnrollInput = z.infer<typeof validEnrollment>;

const NO_SEASON_MESSAGE = "Aucune saison n’est paramétrée.";
const WITHOUT_SEASON: Preview = { status: "invalid", message: NO_SEASON_MESSAGE };

/** Price preview, recomputed on the server on every change to the input. */
export async function preview(entry: FormInput): Promise<Preview> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const parsed = validInput.safeParse(entry);
  if (!parsed.success) return { status: "invalid", message: "Saisie invalide." };
  const { payerId: payerId, ...rest } = parsed.data;
  return withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, todayInParis());
    return season ? enrollmentPreview(tx, payerId, season.id, rest) : WITHOUT_SEASON;
  });
}

/**
 * Saves the enrollment; when refused, returns the message to display. `key` is
 * generated once by the form: a retry after a lost response enrolls nothing twice (#260).
 */
export async function enroll(entry: EnrollInput, key: string): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("director", "front_desk");
  const parsed = validEnrollment.safeParse(entry);
  if (!parsed.success || !z.uuid().safeParse(key).success) return { message: "Saisie invalide." };
  const { payerId: payerId, rulesSigned, referralId, ...rest } = parsed.data;
  const today = todayInParis();
  const result = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, today);
    if (!season) return { ok: false as const, message: NO_SEASON_MESSAGE };
    return once(tx, "enrollment", key, parsed.data, storedEnrollment, async () => {
      const saved = await saveEnrollment(tx, userId, payerId, season.id, rest, today);
      if (!saved.ok) return saved;
      // Signed with this enrollment: on its date (#296 default). One already recorded keeps its own.
      if (rulesSigned) {
        const [rules] = await payersRules(tx, [payerId], season.id);
        if (rules && rules.acceptedOn === null) {
          const r = await acceptRules(tx, userId, payerId, season.id, today, today);
          if (!r.ok) return r;
        }
      }
      if (referralId) {
        const r = await setReferralIfNone(tx, userId, rest.studentIds, referralId);
        if (!r.ok) return r;
      }
      return saved;
    });
  });
  if (!result.ok) return { message: result.message };
  // Courses of two businesses: one enrollment each (#299), said in the banner.
  const several = (result.ids?.length ?? 1) > 1;
  redirect(`/eleves/${rest.studentIds[0]}?inscription=${several ? "enregistrees" : "enregistree"}`);
}
