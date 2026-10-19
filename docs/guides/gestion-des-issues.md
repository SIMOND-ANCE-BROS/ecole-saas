# Gestion des issues, des branches et des PR

Les issues GitHub sont **la source de vérité du travail**. Tout ce qui se fait
(code, découverte, décision) est rattaché à une issue. Ce guide fixe la forme
d'une issue, la façon de la classer, et le chemin d'une branche jusqu'à `main`.
Méthode reprise de FFD-Connect, adaptée : une seule branche longue (`main`),
pas encore d'environnement de recette.

> Les issues ne contiennent **aucune donnée personnelle** (nom d'élève, de
> famille, téléphone) ni secret : décrire avec des données fictives.

## 1. Tout est lié à une issue

| Situation | Règle |
| --- | --- |
| Une PR | Référence au moins une issue : `Closes #N`, ou `Refs #N` si l'issue demande encore d'autres PR (§8). |
| Pas encore d'issue | La créer **avant** d'ouvrir la PR, après recherche de doublon. |
| Découverte en cours de route (bug, dette, faille, test instable, doc périmée) | Ne pas corriger en silence ni la laisser dans la conversation : ouvrir une issue (ou commenter l'existante) avec la preuve. La corriger dans la PR courante seulement si c'est petit et dans le sujet, en la référençant quand même. |
| Question métier en suspens | Dans l'issue concernée (section « Questions ouvertes »), avec le label `blocked` tant qu'elle bloque. |
| Corvée triviale (typo, lockfile) | Peut référencer l'issue la plus proche. |

## 2. Titre

Format : **`DOMAINE: phrase en français`**. La phrase décrit le **résultat
attendu** (fonctionnalité, tâche) ou le **symptôme observé** (bug), sans point final.

- Bon : `TARIF: calculer le prix des inscriptions d’un payeur avec le détail du calcul`
- Bon (bug) : `CI: le typecheck échoue sur un clone neuf faute de types de routes Next`
- Mauvais : `[BUG] souci tarif`, `fix`, `Amélioration`

Domaines (en majuscules) :

- Métier : `TARIF`, `INSCRIPTION`, `PLANNING`, `FAMILLES`, `FACTURATION`,
  `CONNECTEUR`, `PAIE`, `AUTH`, `TABLEAU-DE-BORD`, `REPRISE`
- Transverses : `SÉCURITÉ`, `RGPD`, `LÉGAL`, `DB`, `UI`, `INFRA`, `CI`, `DÉPS`,
  `DOCS`, `QA`

Une **epic** porte le type `Epic` ; son titre nomme le thème, **sans préfixe**
(ex. `Moteur de tarif et réductions`).

## 3. Description

En français. Sections dans cet ordre, en supprimant celles qui ne s'appliquent pas :

```markdown
## Contexte
Pourquoi on en parle, en une ou deux phrases ; epic concernée.

## Constat          ← bug / découverte
Ce qui se passe, avec la preuve : `fichier:ligne`, sortie de commande.
Pour un bug : étapes, attendu / obtenu.

## Attendu          ← fonctionnalité / tâche
Le comportement visé, cas nominal et limites.

## Critères d’acceptation
- [ ] Vérifiable, un par ligne (tests à écrire compris)

## Questions ouvertes   ← règle métier à confirmer
1. …

## Hors périmètre
Ce qui n'est volontairement pas couvert.

## Liens
Epic parente, issues bloquantes, PR, doc.
```

Quand une issue vieillit, on ne réécrit pas son historique : on ajoute en tête
une section **`## État au AAAA-MM-JJ`**.

## 4. Type

Le **type d'issue** de l'organisation est obligatoire :

| Type | Pour |
| --- | --- |
| `Bug` | Un comportement existant est faux (ou le deviendra à coup sûr). |
| `Feature` | Une capacité nouvelle pour l'école (accueil, direction, professeurs). |
| `Task` | Travail technique sans effet visible : CI, dépendances, dette, outillage, doc. |
| `Epic` | Un thème qui regroupe plusieurs issues (sub-issues). Pas de code direct. |

## 5. Priorité, effort et labels

La priorité et l'effort sont des **champs d'issue** de l'organisation
(`Priority`, `Effort`), pas des labels. Ils se posent dans le panneau latéral
de l'issue ou par l'API GraphQL (`setIssueFieldValue`) : `gh issue edit` ne
sait pas les modifier.

**Priority** : une sur toute issue ouverte, sauf `icebox` et sauf une `Epic`
(son urgence se lit sur ses sub-issues).

| `Priority` | Sens |
| --- | --- |
| `Urgent` | Bloquant, sécurité, fuite entre écoles, donnée personnelle exposée, montant faux : maintenant. |
| `High` | Nécessaire au prochain jalon et sur le chemin critique. |
| `Medium` | Nécessaire avant la mise en production. |
| `Low` | Amélioration, peut glisser. |

**Effort** : `Low` (moins d'une demi-journée), `Medium` (un à trois jours),
`High` (plusieurs jours ou plusieurs PR, ou dépendance externe).

**Labels** :

1. `icebox` : idée non planifiée (ni priorité ni milestone).
2. **Zones**, une ou plusieurs : `domaine` (logique pure), `db`, `ui`,
   `connecteur`, `infra`, `ci`, `testing`, `documentation`, `dependencies`,
   `securite`.
3. **Domaines** si utile : `tarif`, `inscription`, `planning`, `familles`,
   `facturation`, `paie`, `auth`.
4. **Statut** : `blocked` (une autre issue, une réponse métier ou un tiers bloque).

On réutilise les labels existants ; on n'en crée un nouveau qu'en le
documentant ici.

## 6. Milestones

1. **V1 — Rentrée 2027** : la feuille de route V1 (CLAUDE.md §11).

Description d'un milestone, toujours dans ce format :

```markdown
🎯 Objectif : ce qui est vrai pour l'école quand le milestone est fermé.

✅ Critères de sortie :
- condition vérifiable ;
- aucune issue Urgent ou High ouverte dans ce milestone.

📦 Périmètre : les epics couvertes.

🚫 Hors périmètre : ce qui est repoussé, et vers où.

📅 Échéance : une date, ou la condition qui permettra de la fixer.
```

On la met à jour quand le périmètre change.

## 7. Relations

| Relation | Outil GitHub | Règle |
| --- | --- | --- |
| Appartient à un thème | **Sub-issue** de l'epic | Un seul parent. |
| Dépend d'une autre issue | **Blocked by** | + label `blocked` tant que le bloquant est ouvert. |
| Doublon | Fermeture `duplicate` | Commentaire « Fusionnée dans #X ». |
| Mentionne sans dépendre | `#N` dans le texte | — |

Une epic se ferme quand toutes ses sub-issues sont fermées.

## 8. Branches, PR et Project « École de danse — Roadmap »

**Branches.** On ne pousse jamais directement sur `main`. Une branche part de
`main` avec un préfixe autorisé, contrôlé par la CI (`.github/workflows/pr-branche.yml`) :

| Préfixe | Pour |
| --- | --- |
| `feature/` | Fonctionnalité (`feature/11-moteur-tarif`) |
| `fix/` | Correction de bug |
| `refactor/` | Restructuration sans changement de comportement |
| `test/` | Tests seuls |
| `docs/` | Documentation |
| `chore/` | CI, dépendances, outillage (pas `ci/`) |
| `hotfix/` | Correction urgente |
| `claude/`, `dependabot/` | Branches créées par les outils |

Nom conseillé : `<préfixe>/<n° d'issue>-<quelques-mots>`.

**PR.** Le modèle (`.github/pull_request_template.md`) demande : l'issue, un
résumé, ce qui change pour l'accueil et la direction, le plan de test.
Commits et titres de PR en français à l'impératif. Rien n'est mergé sans
l'accord explicite du responsable du projet.

- `Closes #N` : la PR termine l'issue. Merge ⇒ issue fermée ⇒ `Done`.
- `Refs #N` : la PR fait avancer l'issue sans la terminer. Merge ⇒ la carte
  revient `In Progress`.

Un squash merge recopie les messages de commits : pas de `Closes` dans un
commit d'une PR `Refs`.

**Project.** Toute issue ouverte est dans le Project de l'organisation. Sa
colonne `Status` avance toute seule (`.github/workflows/project-status.yml`) :

| `Status` | Quand | Déclencheur |
| --- | --- | --- |
| `Todo` | Triée, pas commencée | issue ouverte ou rouverte, PR fermée sans merge |
| `In Progress` | Branche ou PR brouillon | PR **draft** qui référence l'issue, PR `Refs` mergée |
| `In Review` | PR prête à relire | PR « Ready for review » |
| `Done` | Mergée, issue fermée | issue fermée |

Le workflow a besoin du secret `PROJECT_TOKEN` (jeton avec accès en écriture
aux Projects de l'organisation) ; sans lui, il prévient et ne fait rien.
À la main : `.github/scripts/project-status.sh "In Progress" 11`.

**Créer = trier.** Une issue n'est jamais laissée à moitié créée : juste
après `gh issue create` (labels et milestone dans la commande), poser son
type, `Priority` / `Effort`, son parent et l'ajouter au Project.

## 9. Fermer

Toujours avec un motif et un commentaire d'une ligne :

- `completed` : cite la PR (« Livré par #N ») ;
- `not_planned` : dit pourquoi (dépassée, hors périmètre, remplacée par #N) ;
- `duplicate` : « Fusionnée dans #N ».
