import { LIBELLES_STATUT_INSCRIPTION } from "../inscription/statuts";
import type { DefColonne } from "./filtres";

/**
 * Colonnes filtrables de chaque liste, partagées par la page (serveur), la
 * requête SQL et la barre de filtres (navigateur). Les identifiants
 * apparaissent dans l'adresse : ne pas les renommer sans raison.
 */

export const COLONNES_ELEVES: DefColonne[] = [
  { id: "nom", libelle: "Élève", type: "texte", obligatoire: true },
  { id: "age", libelle: "Âge", type: "nombre", droite: true },
  { id: "responsables", libelle: "Responsables", type: "texte" },
  { id: "facture", libelle: "Facturé à", type: "texte", siVide: "l’élève" },
  // Filtrées par cases à cocher (#107) : statuts connus ; les cours viennent du planning de la saison.
  {
    id: "inscription",
    libelle: "Inscription",
    type: "texte",
    siVide: "aucune",
    choix: Object.values(LIBELLES_STATUT_INSCRIPTION),
  },
  { id: "cours", libelle: "Cours suivis", type: "texte", siVide: "aucun" },
  { id: "telephone", libelle: "Téléphone", type: "telephone" },
  // Proposées dans « Colonnes », masquées par défaut (#89).
  { id: "naissance", libelle: "Naissance", type: "date", parDefaut: false },
  { id: "email", libelle: "E-mail", type: "texte", courriel: true, parDefaut: false },
  { id: "prevenir", libelle: "À prévenir", type: "texte", parDefaut: false },
];

export const COLONNES_CONTACTS: DefColonne[] = [
  { id: "nom", libelle: "Contact", type: "texte", obligatoire: true },
  { id: "eleves", libelle: "Pour les élèves", type: "texte" },
  { id: "telephone", libelle: "Téléphone", type: "telephone" },
  { id: "email", libelle: "E-mail", type: "texte", courriel: true },
];

export const COLONNES_INTERVENANTS: DefColonne[] = [
  { id: "nom", libelle: "Nom", type: "texte", obligatoire: true },
  { id: "statut", libelle: "Statut", type: "texte" },
  { id: "cours", libelle: "Cours", type: "nombre", droite: true },
  /** Réservée à la direction : la page la retire pour l'accueil. */
  { id: "tarif", libelle: "Tarif", type: "texte", droite: true, filtrable: false, triable: false },
  { id: "email", libelle: "E-mail", type: "texte", courriel: true },
];

/** Listes dont la disposition des colonnes est mémorisée par membre (#89). */
export const LISTES = {
  eleves: COLONNES_ELEVES,
  contacts: COLONNES_CONTACTS,
  intervenants: COLONNES_INTERVENANTS,
} as const;
export type Liste = keyof typeof LISTES;
