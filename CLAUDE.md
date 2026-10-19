@AGENTS.md

# CLAUDE.md – Gestion d'école de danse (SaaS)

Ce fichier est la référence pour tout agent qui développe ce projet. Lis-le en entier avant de coder. En cas de doute sur une règle métier, **demande** plutôt que d'inventer.

## 1. Le projet

- Logiciel SaaS de gestion pour écoles de danse : familles et élèves, inscriptions, planning, facturation, encaissements, rémunération des professeurs.
- Premier client (« client fondateur ») : École de danse Ribas, Villeurbanne. Mise en production visée : **été 2027**, pour les inscriptions de la rentrée.
- Le produit doit être **réplicable pour d'autres écoles** : tout ce qui est propre à Ribas est une donnée, jamais du code.
- Utilisateurs V1 : la direction et l'accueil, sur un ordinateur Windows, dans un navigateur. Usage intensif pendant les permanences d'inscription : la **saisie rapide** prime sur l'esthétique.
- Développeur unique (Gabin Simond), développement piloté par IA.

## 2. Vocabulaire métier

| Terme | Sens |
| --- | --- |
| École | Le locataire (tenant). Toutes les données lui appartiennent. |
| Payeur | Qui reçoit la facture : parent, entreprise, CSE. Distinct du danseur. |
| Danseur | L'élève. Rattaché à un payeur. Souvent mineur. |
| Inscription | Un forfait souscrit par un payeur pour une saison ; couvre un ou deux danseurs (tarif couple). |
| Forfait | Prix calculé selon la **durée hebdomadaire cumulée** des cours choisis, pas selon chaque cours. |
| Cours | Créneau récurrent (jour, heure, durée, salle, professeur). |
| Séance | Occurrence datée d'un cours. Sert à l'appel, aux carnets et à la paie des professeurs. |
| Carnet | Pack de cours particuliers (1, 5 ou 10 séances, 1 à 4 personnes). |
| Intervenant | Professeur. Facture l'école (micro-entreprise, société) ou est salarié. |
| Relevé | Calcul mensuel de ce que l'école doit à un intervenant, d'après les séances effectuées. |
| Échéance | Fraction d'une facture payable à une date (paiement en plusieurs fois). |
| Avoir | Facture négative qui annule tout ou partie d'une facture émise. |
| Outil de facturation | Pennylane, Abby ou Shine : émet les factures, les numérote, fait l'e-reporting. |

## 3. Règles métier connues (école Ribas, à paramétrer)

- Forfaits trimestriels ou annuels selon la durée hebdo cumulée (45 min, 1 h, 1 h 30 et combinaisons jusqu'à 3 cours) ; grilles enfant, adulte, couple, étudiant ; cours à l'unité.
- Réduction **fratrie -10 %** dès deux enfants d'un même payeur, **non cumulable** avec le forfait 2 disciplines.
- 2 sites, 3 salles : Docteur Rollet (2 salles, cours collectifs, permanences), Bons Amis (1 salle, compétition et cours particuliers).
- 8 professeurs, dont les deux dirigeants (micro-entreprises en franchise de TVA, mention « TVA non applicable, art. 293 B du CGI »).
- Calendrier : vacances scolaires zone A, gala en juin.
- Moyens de paiement : chèque, espèces, carte, virement, prélèvement, chèques vacances ANCV, Pass'Sport.

Ces valeurs vont dans les tables `tarif`, `reduction`, `site`, `salle`, `intervenant`, `fermeture`. **Jamais en dur dans le code.**

## 4. Facturation électronique (contexte légal)

- Réception des factures électroniques obligatoire depuis le 1er septembre 2026 ; émission et e-reporting obligatoires pour les PME au **1er septembre 2027**.
- Les ventes aux familles (B2C) passent en **e-reporting** ; les factures des professeurs à l'école sont du **B2B** électronique.
- Le logiciel n'est pas une plateforme agréée : il **délègue** à l'outil de facturation choisi par l'école.
- Conséquences dans le code :
  - Le logiciel **ne génère jamais de numéro de facture** : il stocke celui renvoyé par l'outil.
  - Une facture émise ne se modifie pas : on émet un **avoir**.
  - Les mentions TVA viennent de la configuration de l'école (`ecole.regime_tva`, `ecole.mention_tva`).
- Le régime TVA de l'école et l'outil choisi sont **en attente de l'avis de l'expert-comptable** : garder ces points paramétrables.

## 5. Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · PostgreSQL 16 · Drizzle ORM · Zod · Tailwind 4 · Vitest. À venir : shadcn/ui, Better Auth, pg-boss (tâches de fond), Playwright.

```bash
npm run dev          # serveur local
npm test             # Vitest
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run db:up        # PostgreSQL local (Docker)
npm run db:generate  # nouvelle migration après modification du schéma
npm run db:migrate   # appliquer les migrations
```

## 6. Organisation du code

```
src/
  app/                    routes Next.js (pages, server actions) – fines, sans logique métier
  db/schema.ts            modèle de données (source de vérité)
  db/index.ts             connexion + avecEcole() / ecolesDe()
  domaine/<module>/       logique métier PURE + tests (tarif, inscription, planning, facturation, paie)
  connecteurs/facturation/  interface commune + une implémentation par outil
  jobs/                   tâches de fond (synchro facturation, génération des séances)
  lib/                    utilitaires transverses (montant.ts…)
migrations/               générées par drizzle-kit + migrations SQL personnalisées (RLS)
```

- La logique métier vit dans `src/domaine/` sous forme de **fonctions pures** (entrées → sorties, sans base ni réseau), testées unitairement. Les routes et server actions ne font que valider, appeler le domaine et persister.
- Le connecteur de facturation expose une interface unique (`creerClient`, `creerFacture`, `finaliser`, `creerAvoir`, `lireStatut`) ; le reste du code ne connaît jamais l'outil concret.

## 7. Règles impératives

**Multi-école et sécurité**
- Toute requête métier passe par `avecEcole(ecoleId, tx => …)`. Ne jamais utiliser `db` directement pour des données métier.
- Toute nouvelle table métier porte `ecole_id` **et** reçoit, dans une migration SQL, `ENABLE` + `FORCE ROW LEVEL SECURITY` et la politique `isolation_ecole` (modèle dans `migrations/0001_rls.sql`, qui ne s'applique qu'aux tables existantes à sa création).
- Le rôle `app_admin` (BYPASSRLS) est réservé aux scripts d'administration, jamais au code de l'application.
- `ecoleId` vient toujours de la session côté serveur, jamais d'un paramètre envoyé par le navigateur.

**Argent et dates**
- Montants en **centimes entiers** (`*_centimes`), taux en **points de base** (1000 = 10 %). Utiliser `src/lib/montant.ts`. Aucun `number` à virgule pour de l'argent, aucun `parseFloat` sur un montant.
- Dates sans heure (`date`) manipulées comme chaînes `YYYY-MM-DD` ; fuseau `Europe/Paris` pour tout calcul de jour.

**Données**
- Paiements et journal sont **inaltérables** (triggers en base) : une erreur se corrige par une écriture inverse.
- Ne jamais modifier une migration déjà appliquée : en créer une nouvelle.
- Valider toute entrée externe (formulaires, API, webhooks) avec Zod.

**Données personnelles (élèves mineurs)**
- Ne jamais écrire de données personnelles dans les logs (noms, téléphones, santé).
- Les identifiants des outils de facturation sont stockés chiffrés (`connecteur_facturation.identifiants_chiffres`), jamais en clair, jamais dans le dépôt.
- Aucun secret dans le code : variables d'environnement, et `.env.example` tenu à jour.

## 8. Tests

- Toute fonction du domaine a ses tests Vitest, écrits **avant ou avec** le code. Priorité absolue : moteur de tarif, réductions, échéanciers, relevés des professeurs.
- Couvrir les cas limites réels : fratrie de trois enfants, couple + réduction, abandon en cours de trimestre, remplacement d'un professeur, centimes restants d'une répartition.
- Les comportements de sécurité (RLS, inaltérabilité) se testent contre une vraie base PostgreSQL, pas avec des mocks.
- Recommandé : un test qui échoue si une table portant `ecole_id` n'a pas la RLS activée.

## 9. Façon de travailler

- Avant de terminer une tâche : `npm run lint`, `npm run typecheck`, `npm test` doivent passer.
- Petits commits, messages en français à l'impératif (« Ajoute le calcul de la réduction fratrie »).
- **Demander avant** d'ajouter une dépendance. Versions figées exactes, publiées depuis au moins 14 jours. Pas de dépendance pour ce qui tient en quelques lignes.
- Ne pas modifier `migrations/0001_rls.sql`, les triggers d'inaltérabilité ou `avecEcole()` sans le signaler explicitement.
- Si une décision d'architecture change, mettre à jour ce fichier dans le même commit.

## 10. Interface

- Textes en français, avec apostrophe typographique (’) et guillemets « » dans les contenus affichés.
- Pensé pour l'ordinateur de l'accueil d'abord : formulaires utilisables au clavier, recherche instantanée d'une famille, peu de clics pour une inscription.
- Accessible : libellés sur tous les champs, contrastes suffisants, mode sombre.

## 11. Feuille de route V1

1. [ ] Moteur de tarif et réductions (`src/domaine/tarif`)
2. [ ] Authentification, membres et rôles (direction, accueil, professeur)
3. [ ] Familles, danseurs, documents
4. [ ] Sites, salles, saisons, fermetures, cours ; génération des séances
5. [ ] Inscriptions (avec le moteur de tarif), carnets
6. [ ] Factures, échéanciers, avoirs, paiements, attestations
7. [ ] Connecteur de facturation (outil à confirmer) + tâches de synchronisation
8. [ ] Relevés des professeurs
9. [ ] Tableau de bord et export comptable
10. [ ] Reprise des données de l'ancien logiciel

Hors V1 : espace familles en ligne, inscription et paiement en ligne, accès des professeurs sur mobile.
