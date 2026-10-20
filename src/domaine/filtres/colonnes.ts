import type { DefColonne } from "./filtres";

/**
 * Colonnes filtrables de chaque liste, partagées par la page (serveur), la
 * requête SQL et la barre de filtres (navigateur). Les identifiants
 * apparaissent dans l'adresse : ne pas les renommer sans raison.
 */

export const COLONNES_ELEVES: DefColonne[] = [
  { id: "nom", libelle: "Élève", type: "texte" },
  { id: "age", libelle: "Âge", type: "nombre", droite: true },
  { id: "responsables", libelle: "Responsables", type: "texte" },
  { id: "facture", libelle: "Facturé à", type: "texte", siVide: "l’élève" },
  { id: "telephone", libelle: "Téléphone", type: "telephone" },
];

export const COLONNES_CONTACTS: DefColonne[] = [
  { id: "nom", libelle: "Contact", type: "texte" },
  { id: "eleves", libelle: "Pour les élèves", type: "texte" },
  { id: "telephone", libelle: "Téléphone", type: "telephone" },
  { id: "email", libelle: "E-mail", type: "texte", courriel: true },
];

export const COLONNES_INTERVENANTS: DefColonne[] = [
  { id: "nom", libelle: "Nom", type: "texte" },
  { id: "statut", libelle: "Statut", type: "texte" },
  { id: "cours", libelle: "Cours", type: "nombre", droite: true },
  /** Réservée à la direction : la page la retire pour l'accueil. */
  { id: "tarif", libelle: "Tarif", type: "texte", droite: true, filtrable: false },
  { id: "email", libelle: "E-mail", type: "texte", courriel: true },
];

/** Listes dont la disposition des colonnes est mémorisée par membre (#89). */
export const LISTES = { eleves: COLONNES_ELEVES, contacts: COLONNES_CONTACTS, intervenants: COLONNES_INTERVENANTS } as const;
export type Liste = keyof typeof LISTES;
