ALTER TABLE "personne" ADD COLUMN "eleve" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Reprise (#77) : est élève qui a une date de naissance, suit ou a suivi un
-- cours, ou a un représentant légal ; les autres sont des contacts.
UPDATE personne p SET eleve = true
WHERE p.date_naissance IS NOT NULL
   OR EXISTS (SELECT 1 FROM inscription_cours ic WHERE ic.danseur_id = p.id)
   OR EXISTS (SELECT 1 FROM lien l WHERE l.lie_a_id = p.id AND l.type = 'representant_legal');
