import { ENROLLMENT_STATUS_LABELS } from "../enrollment/statuses";
import type { ColumnDef } from "./filters";

/**
 * Colonnes filtrables de chaque liste, partagées par la page (serveur), la
 * requête SQL et la barre de filtres (navigateur). Les identifiants
 * apparaissent dans l'adresse : ne pas les renommer sans raison.
 */

export const STUDENT_COLUMNS: ColumnDef[] = [
  { id: "nom", label: "Élève", type: "texte", required: true },
  { id: "age", label: "Âge", type: "nombre", right: true },
  { id: "responsables", label: "Responsables", type: "texte" },
  { id: "facture", label: "Facturé à", type: "texte", ifEmpty: "l’élève" },
  // Filtrées par cases à cocher (#107) : statuts connus ; les cours viennent du planning de la saison.
  {
    id: "inscription",
    label: "Inscription",
    type: "texte",
    ifEmpty: "aucune",
    choice: Object.values(ENROLLMENT_STATUS_LABELS),
  },
  { id: "cours", label: "Cours suivis", type: "texte", ifEmpty: "aucun" },
  { id: "telephone", label: "Téléphone", type: "telephone" },
  // Proposées dans « Colonnes », masquées par défaut (#89).
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
  /** Réservée à la direction : la page la retire pour l'accueil. */
  { id: "tarif", label: "Tarif", type: "texte", right: true, filterable: false, sortable: false },
  { id: "email", label: "E-mail", type: "texte", email: true },
];

/** Listes dont la disposition des colonnes est mémorisée par membre (#89). */
export const LISTES = {
  eleves: STUDENT_COLUMNS,
  contacts: CONTACT_COLUMNS,
  intervenants: INSTRUCTOR_COLUMNS,
} as const;
export type List = keyof typeof LISTES;
