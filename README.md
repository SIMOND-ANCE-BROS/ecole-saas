# Gestion d'école de danse

Logiciel SaaS de gestion pour écoles de danse : inscriptions, planning, fiches familles et danseurs, rémunération des professeurs, facturation connectée à une plateforme agréée (facturation électronique et e-reporting). Premier client : École de danse Ribas, Villeurbanne.

## Stack

Next.js (App Router) · TypeScript · PostgreSQL · Drizzle ORM · Zod · Tailwind · Vitest

## Démarrer

```bash
cp .env.example .env   # puis renseigner BETTER_AUTH_SECRET (openssl rand -hex 32)
npm install
npm run db:up        # PostgreSQL local via Docker
npm run db:migrate   # schéma + Row Level Security
npm run db:seed      # école et comptes de démonstration (accueil@demo.test)
npm run dev
```

## Scripts

| Script | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm test` | tests unitaires (Vitest) |
| `npm run test:integration` | tests d’intégration contre la base locale (dont le garde-fou RLS) |
| `npm run typecheck` | vérification TypeScript |
| `npm run lint` | ESLint |
| `npm run db:generate` | génère une migration après modification de `src/db/schema.ts` |
| `npm run db:migrate` | applique les migrations |
| `npm run db:seed` | données de démonstration locales (école fictive, comptes accueil et direction) |

## Architecture

- `src/db/schema.ts` : modèle de données multi-école.
- `migrations/0001_rls.sql` : isolation entre écoles (Row Level Security), paiements et journal inaltérables.
- `src/db/index.ts` : `avecEcole(ecoleId, tx => …)` limite une transaction à une école.
- `src/lib/montant.ts` : calculs monétaires en centimes.

Rôles PostgreSQL : `app_user` pour l'application (soumis à la RLS), `app_admin` pour la création d'écoles et le support (`BYPASSRLS`), propriétaire de la base pour les migrations.

Voir `AGENTS.md` pour les conventions de code.
