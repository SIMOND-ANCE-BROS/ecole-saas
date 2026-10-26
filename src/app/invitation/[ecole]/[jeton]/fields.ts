import { formFields } from "@/lib/form-fields";

/** Fields of the invitation or reset form (link-form.tsx ↔ actions.ts). */
export const LINK = formFields("name", "password", "confirmation", "currentPassword");
