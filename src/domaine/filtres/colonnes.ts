import { LIBELLES_STATUT_INSCRIPTION } from "../inscription/statuts";
import type { DefColonne } from "./filtres";
import type { GroupeRaccourcis } from "./raccourcis";

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
  { id: "telephone", libelle: "Téléphone", type: "telephone" },
  // Proposées dans « Colonnes », masquées par défaut (#89).
  { id: "naissance", libelle: "Naissance", type: "date", parDefaut: false },
  { id: "email", libelle: "E-mail", type: "texte", courriel: true, parDefaut: false },
  { id: "cours", libelle: "Cours suivis", type: "texte", parDefaut: false },
  { id: "inscription", libelle: "Inscription", type: "texte", parDefaut: false, siVide: "aucune" },
  { id: "prevenir", libelle: "À prévenir", type: "texte", parDefaut: false },
];

/** Boutons de filtre de la liste des élèves (#107) ; le choix du cours s'y ajoute d'après le planning. */
export const RACCOURCIS_ELEVES: GroupeRaccourcis[] = [
  {
    id: "inscription",
    libelle: "Inscription",
    choix: [
      { id: "inscrits", libelle: "Inscrits", conditions: [{ colonne: "inscription", operateur: "est", valeur: LIBELLES_STATUT_INSCRIPTION.active }] },
      { id: "essai", libelle: LIBELLES_STATUT_INSCRIPTION.essai, conditions: [{ colonne: "inscription", operateur: "est", valeur: LIBELLES_STATUT_INSCRIPTION.essai }] },
      { id: "attente", libelle: LIBELLES_STATUT_INSCRIPTION.liste_attente, conditions: [{ colonne: "inscription", operateur: "est", valeur: LIBELLES_STATUT_INSCRIPTION.liste_attente }] },
      { id: "sans", libelle: "Sans inscription", conditions: [{ colonne: "inscription", operateur: "vide", valeur: "" }] },
    ],
  },
  {
    id: "age",
    libelle: "Âge",
    choix: [
      { id: "mineurs", libelle: "Mineurs", conditions: [{ colonne: "age", operateur: "inf", valeur: "18" }] },
      { id: "majeurs", libelle: "Majeurs", conditions: [{ colonne: "age", operateur: "sup_egal", valeur: "18" }] },
    ],
  },
];

/** Groupe « Cours » : un choix par cours de la saison (libellés comme dans la colonne « Cours suivis »). */
export const raccourcisCours = (libelles: string[]): GroupeRaccourcis => ({
  id: "cours",
  libelle: "Cours",
  choix: libelles.map((l) => ({ id: l, libelle: l, conditions: [{ colonne: "cours", operateur: "est", valeur: l }] })),
});

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
export const LISTES = { eleves: COLONNES_ELEVES, contacts: COLONNES_CONTACTS, intervenants: COLONNES_INTERVENANTS } as const;
export type Liste = keyof typeof LISTES;
