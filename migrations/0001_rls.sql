-- =====================================================================
-- Isolation multi-école (Row Level Security) et règles d'inaltérabilité
-- À appliquer après la migration générée par drizzle-kit.
--
-- L'application se connecte avec le rôle `app_user` (ni propriétaire ni
-- superutilisateur) et fixe l'école courante dans chaque transaction :
--   SELECT set_config('app.ecole_id', '<uuid>', true);
-- Sans cette variable, aucune ligne n'est visible ni insérable.
-- =====================================================================

-- Prérequis, à créer une fois par un administrateur de la base :
--   CREATE ROLE app_user LOGIN PASSWORD '...';      -- l'application
--   CREATE ROLE app_admin LOGIN PASSWORD '...' BYPASSRLS;  -- création d'écoles, support

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Une politique d'isolation sur chaque table qui porte ecole_id.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'ecole_id'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY isolation_ecole ON %I
        USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
        WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END $$;

-- La table ecole elle-même : une école ne voit qu'elle.
ALTER TABLE ecole ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecole FORCE ROW LEVEL SECURITY;
CREATE POLICY isolation_ecole ON ecole
  USING (id = nullif(current_setting('app.ecole_id', true), '')::uuid);

-- À la connexion, l'utilisateur doit pouvoir lister ses écoles avant d'en
-- choisir une : on fixe alors app.user_id au lieu de app.ecole_id.
CREATE POLICY mes_appartenances ON membre FOR SELECT
  USING (user_id = nullif(current_setting('app.user_id', true), ''));
CREATE POLICY mes_ecoles ON ecole FOR SELECT
  USING (id IN (SELECT ecole_id FROM membre
                WHERE user_id = nullif(current_setting('app.user_id', true), '')));

-- ---------------------------------------------------------------------
-- Paiements : ni suppression, ni modification (sauf l'indicateur de synchro)
-- ---------------------------------------------------------------------
CREATE FUNCTION paiement_inalterable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un paiement ne se supprime pas : saisir un paiement négatif';
  END IF;
  IF (to_jsonb(NEW) - 'synchro_outil') <> (to_jsonb(OLD) - 'synchro_outil') THEN
    RAISE EXCEPTION 'Un paiement ne se modifie pas : saisir un paiement correctif';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER paiement_inalterable
  BEFORE UPDATE OR DELETE ON paiement
  FOR EACH ROW EXECUTE FUNCTION paiement_inalterable();

-- ---------------------------------------------------------------------
-- Journal : ajout seulement
-- ---------------------------------------------------------------------
CREATE FUNCTION journal_ajout_seul() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le journal ne peut être ni modifié ni supprimé';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER journal_ajout_seul
  BEFORE UPDATE OR DELETE ON journal
  FOR EACH ROW EXECUTE FUNCTION journal_ajout_seul();
