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
