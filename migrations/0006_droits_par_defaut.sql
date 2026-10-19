-- Droits par défaut de app_user sur les tables et séquences créées par les
-- migrations futures. Le GRANT de 0001_rls.sql ne couvrait que les tables
-- existantes à l'époque : une nouvelle table aurait été inaccessible
-- (permission denied). Sans FOR ROLE : s'applique au rôle qui exécute les
-- migrations, quel que soit son nom selon l'environnement.
-- La RLS reste obligatoire sur toute nouvelle table métier (garde-fou :
-- src/db/rls.integration.test.ts).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
