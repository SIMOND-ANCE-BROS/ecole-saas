"use server";

import { redirect } from "next/navigation";
import { chooseSchool } from "@/lib/school-access";
import { currentSession } from "@/lib/session";

/** The school submitted by the form is only accepted if the user is an active member of it. */
export async function chooseSchoolAction(formData: FormData) {
  const { session, user } = await currentSession();
  const retained = await chooseSchool(session.id, user.id, String(formData.get("schoolId") ?? ""));
  redirect(retained ? "/" : "/ecoles");
}
