-- Isolation multi-école de la grille des carnets (modèle : 0001_rls.sql).
ALTER TABLE tarif_carnet ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tarif_carnet FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON tarif_carnet
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);
