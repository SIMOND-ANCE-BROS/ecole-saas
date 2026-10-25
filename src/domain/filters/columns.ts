import { ENROLLMENT_STATUS_LABELS } from "../enrollment/statuses";
import type { ColumnDef } from "./filters";

/**
 * Filterable columns of each list, shared by the page (server), the SQL
 * query and the filter bar (browser). The ids appear in the URL: do not
 * rename them without a reason.
 */

export const STUDENT_COLUMNS = [
  { id: "nom", label: "Élève", type: "text", required: true },
  { id: "age", label: "Âge", type: "number", right: true },
  { id: "responsables", label: "Responsables", type: "text" },
  { id: "facture", label: "Facturé à", type: "text", ifEmpty: "l’élève" },
  // Filtered by checkboxes (#107): known statuses; the courses come from the season's schedule.
  {
    id: "inscription",
    label: "Inscription",
    type: "text",
    ifEmpty: "aucune",
    choice: Object.values(ENROLLMENT_STATUS_LABELS),
  },
  { id: "cours", label: "Cours suivis", type: "text", ifEmpty: "aucun" },
  { id: "telephone", label: "Téléphone", type: "phone" },
  // Offered in « Colonnes », hidden by default (#89).
  { id: "naissance", label: "Naissance", type: "date", byDefault: false },
  { id: "email", label: "E-mail", type: "text", email: true, byDefault: false },
  { id: "prevenir", label: "À prévenir", type: "text", byDefault: false },
] as const satisfies readonly ColumnDef[];

export const CONTACT_COLUMNS = [
  { id: "nom", label: "Contact", type: "text", required: true },
  { id: "eleves", label: "Pour les élèves", type: "text" },
  { id: "telephone", label: "Téléphone", type: "phone" },
  { id: "email", label: "E-mail", type: "text", email: true },
] as const satisfies readonly ColumnDef[];

export const INSTRUCTOR_COLUMNS = [
  { id: "nom", label: "Nom", type: "text", required: true },
  { id: "statut", label: "Statut", type: "text" },
  { id: "cours", label: "Cours", type: "number", right: true },
  /** Management only: the page removes it for the front desk. */
  { id: "tarif", label: "Tarif", type: "text", right: true, filterable: false, sortable: false },
  { id: "email", label: "E-mail", type: "text", email: true },
] as const satisfies readonly ColumnDef[];

/** Ids of a column list, to key its cells and SQL expressions. */
export type ColumnId<C extends readonly ColumnDef[]> = C[number]["id"];

/** Lists whose column layout is saved per member (#89). */
export const LISTS = {
  eleves: STUDENT_COLUMNS,
  contacts: CONTACT_COLUMNS,
  intervenants: INSTRUCTOR_COLUMNS,
} as const;
export type List = keyof typeof LISTS;
