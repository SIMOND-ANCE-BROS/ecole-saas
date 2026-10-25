import { formFields } from "@/lib/form-fields";

/** Fields of the instructor form (instructor-form.tsx ↔ actions.ts). */
export const INSTRUCTOR = formFields(
  "firstName",
  "name",
  "email",
  "status",
  "siren",
  "vatRegime",
  "payMode",
  "tariff",
  "isOwner",
  "active",
);
export type InstructorField = (typeof INSTRUCTOR.names)[number];
