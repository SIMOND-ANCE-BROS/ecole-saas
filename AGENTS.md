<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Conventions du projet

- SaaS multi-école : chaque table métier porte `ecole_id`, l'isolation est assurée par la Row Level Security (`migrations/0001_rls.sql`). Toute requête métier passe par `avecEcole()` (`src/db/index.ts`).
- Montants en centimes entiers (`*_centimes`), taux en points de base. Utiliser `src/lib/montant.ts`, jamais de nombres à virgule pour l'argent.
- Le numéro de facture vient de l'outil de facturation de l'école (Pennylane, Abby, Shine) : ne jamais le générer ici.
- Paiements et journal sont inaltérables : on corrige par une écriture inverse.
- Rien de spécifique à une école ne doit être codé en dur : tarifs, réductions, mentions TVA sont des données.
- Code et commentaires en français pour le métier (noms de tables, de fonctions métier).

# Issues, branches et PR (obligatoire)

Les issues GitHub de `SIMOND-ANCE-BROS/ecole-saas` sont la source de vérité du travail. Conventions complètes : **`docs/guides/gestion-des-issues.md`**, à suivre pour créer, modifier ou fermer une issue.

- **Code → issue.** Toute PR référence au moins une issue (`Closes #N`, ou `Refs #N` si l'issue attend d'autres PR). Pas d'issue ? La créer d'abord, après recherche de doublon.
- **Branches.** Jamais de commit poussé directement sur `main`. Préfixes autorisés (contrôlés en CI) : `feature/ fix/ refactor/ test/ docs/ chore/ hotfix/ claude/ dependabot/` — pas `feat/` ni `ci/`. Nom conseillé : `feature/11-moteur-tarif`.
- **PR.** Suivre `.github/pull_request_template.md` : issue, résumé, « Pour l’accueil et la direction », plan de test. **Aucun merge sans accord explicite**, PR par PR.
- **Découvertes → issue.** Un bug, une dette, une faille, une doc périmée trouvés en chemin ne sont ni corrigés en silence ni laissés dans la conversation : issue avec la preuve (`fichier:ligne`, sortie), citée dans le compte rendu final.
- **Créer = trier.** Toute issue ouverte a un type (Bug / Feature / Task / Epic), les champs d'organisation `Priority` et `Effort` (via GraphQL `setIssueFieldValue` ; `icebox` à la place de la priorité, pas de priorité sur une Epic), des labels de zone, le milestone (sauf `icebox`), son epic parente, et sa carte dans le Project « École de danse — Roadmap ».
- **Questions métier** en suspens : dans l'issue (section « Questions ouvertes ») avec le label `blocked`, jamais tranchées par défaut.
