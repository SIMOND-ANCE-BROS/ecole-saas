-- Exécuté au premier démarrage du conteneur PostgreSQL local.
CREATE ROLE app_user LOGIN PASSWORD 'app_user';
CREATE ROLE app_admin LOGIN PASSWORD 'app_admin' BYPASSRLS;
