import type { DefColonne } from "./filtres";

/**
 * Colonnes filtrables de chaque liste, partagées par la page (serveur), la
 * requête SQL et la barre de filtres (navigateur). Les identifiants
 * apparaissent dans l'adresse : ne pas les renommer sans raison.
 */

export const COLONNES_ELEVES: DefColonne[] = [
  { id: "nom", libelle: "Élève", type: "texte" },
  { id: "age", libelle: "Âge", type: "nombre" },
  { id: "responsables", libelle: "Responsables", type: "texte" },
  { id: "facture", libelle: "Facturé à", type: "texte" },
  { id: "telephone", libelle: "Téléphone", type: "telephone" },
];

export const COLONNES_CONTACTS: DefColonne[] = [
  { id: "nom", libelle: "Contact", type: "texte" },
  { id: "eleves", libelle: "Pour les élèves", type: "texte" },
  { id: "telephone", libelle: "Téléphone", type: "telephone" },
  { id: "email", libelle: "E-mail", type: "texte" },
];

export const COLONNES_INTERVENANTS: DefColonne[] = [
  { id: "nom", libelle: "Nom", type: "texte" },
  { id: "statut", libelle: "Statut", type: "texte" },
  { id: "cours", libelle: "Cours", type: "nombre" },
  { id: "email", libelle: "E-mail", type: "texte" },
];
