import { ENROLLMENT_STATUS_LABELS } from "../enrollment/statuses";
import type { ColumnDef } from "./filters";

/**
 * Filterable columns of each list, shared by the page (server), the SQL
 * query and the filter bar (browser). The ids appear in the URL: do not
 * rename them without a reason.
 */

export const STUDENT_COLUMNS: ColumnDef[] = [
  { id: "nom", label: "Élève", type: "texte", required: true },
  { id: "age", label: "Âge", type: "nombre", right: true },
  { id: "responsables", label: "Responsables", type: "texte" },
  { id: "facture", label: "Facturé à", type: "texte", ifEmpty: "l’élève" },
  // Filtered by checkboxes (#107): known statuses; the courses come from the season's schedule.
  {
    id: "inscription",
    label: "Inscription",
    type: "texte",
    ifEmpty: "aucune",
    choice: Object.values(ENROLLMENT_STATUS_LABELS),
  },
  { id: "cours", label: "Cours suivis", type: "texte", ifEmpty: "aucun" },
  { id: "telephone", label: "Téléphone", type: "telephone" },
  // Offered in « Colonnes », hidden by default (#89).
  { id: "naissance", label: "Naissance", type: "date", byDefault: false },
  { id: "email", label: "E-mail", type: "texte", email: true, byDefault: false },
  { id: "prevenir", label: "À prévenir", type: "texte", byDefault: false },
];

export const CONTACT_COLUMNS: ColumnDef[] = [
  { id: "nom", label: "Contact", type: "texte", required: true },
  { id: "eleves", label: "Pour les élèves", type: "texte" },
  { id: "telephone", label: "Téléphone", type: "telephone" },
  { id: "email", label: "E-mail", type: "texte", email: true },
];

export const INSTRUCTOR_COLUMNS: ColumnDef[] = [
  { id: "nom", label: "Nom", type: "texte", required: true },
  { id: "statut", label: "Statut", type: "texte" },
  { id: "cours", label: "Cours", type: "nombre", right: true },
  /** Management only: the page removes it for the front desk. */
  { id: "tarif", label: "Tarif", type: "texte", right: true, filterable: false, sortable: false },
  { id: "email", label: "E-mail", type: "texte", email: true },
];

/** Lists whose column layout is saved per member (#89). */
export const LISTS = {
  eleves: STUDENT_COLUMNS,
  contacts: CONTACT_COLUMNS,
  intervenants: INSTRUCTOR_COLUMNS,
} as const;
export type List = keyof typeof LISTS;
