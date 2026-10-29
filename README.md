# Gestion d'école de danse

Logiciel SaaS de gestion pour écoles de danse : inscriptions, planning, fiches des personnes (danseurs, parents, payeurs) et de leurs liens, rémunération des professeurs, facturation connectée à une plateforme agréée (facturation électronique et e-reporting). Premier client : École de danse Ribas, Villeurbanne.

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

| Script                     | Rôle                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`              | serveur de développement                                                       |
| `npm test`                 | tests unitaires (Vitest)                                                       |
| `npm run test:integration` | tests d’intégration contre la base locale (dont le garde-fou RLS)              |
| `npm run typecheck`        | vérification TypeScript                                                        |
| `npm run lint`             | ESLint                                                                         |
| `npm run db:generate`      | génère une migration après modification de `src/db/schema.ts`                  |
| `npm run db:migrate`       | applique les migrations (refuse un rôle soumis à la RLS, voir ci-dessous)      |
| `npm run db:seed`          | données de démonstration locales (école fictive, comptes accueil et direction) |

## Architecture

- `src/db/schema.ts` : modèle de données multi-école.
- `migrations/0001_rls.sql` : isolation entre écoles (Row Level Security), paiements et journal inaltérables.
- `src/db/index.ts` : `withSchool(schoolId, tx => …)` limite une transaction à une école.
- `src/lib/money.ts` : calculs monétaires en centimes.

Rôles PostgreSQL : `app_user` pour l'application (soumis à la RLS), `app_admin` pour la création d'écoles et le support (`BYPASSRLS`), propriétaire de la base pour les migrations.

### Rôle des migrations (déploiement)

`DATABASE_ADMIN_URL` doit se connecter avec un rôle qui est **propriétaire des tables (ou superutilisateur) et qui contourne la RLS (superutilisateur ou `BYPASSRLS`)**. Les tables métier sont en `FORCE ROW LEVEL SECURITY` : un simple propriétaire est filtré lui aussi, et une reprise de données dans une migration (0019, 0036…) ne modifierait alors aucune ligne, sans erreur. `npm run db:migrate` (`scripts/migrate.ts`) vérifie ce rôle avant d’appliquer quoi que ce soit et s’arrête sinon (#279). En local et en CI, `proprio` est le superutilisateur du conteneur ; chez un hébergeur managé où le propriétaire n’est pas superutilisateur, lui donner `BYPASSRLS` ou migrer avec un rôle qui l’a.

Ne jamais lancer `drizzle-kit migrate` directement : toujours `npm run db:migrate`, qui fait cette vérification.

Voir `AGENTS.md` pour les conventions de code.
