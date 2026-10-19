-- Reprise des familles en personnes et liens (#67). Les identifiants sont
-- conservés : un payeur ou un danseur devient la personne de même id, si bien
-- que les colonnes payeur_id et danseur_id existantes restent valables.

-- Payeurs.
INSERT INTO personne (id, ecole_id, type, nom, prenom, raison_sociale, siren, email, telephone, adresse, ref_outil, cree_le)
SELECT id, ecole_id, type::text::type_personne, nom, prenom, raison_sociale, siren, email, telephone, adresse, ref_outil, cree_le
FROM payeur;--> statement-breakpoint

-- Danseurs.
INSERT INTO personne (id, ecole_id, type, nom, prenom, date_naissance, notes, cree_le)
SELECT id, ecole_id, 'particulier', nom, prenom, date_naissance, notes, cree_le
FROM danseur;--> statement-breakpoint

-- Le payeur paie pour chaque danseur ; un particulier est représentant légal
-- d'un mineur (ou d'un danseur sans date de naissance), sinon lien « autre ».
INSERT INTO lien (ecole_id, personne_id, lie_a_id, type, paie_pour)
SELECT d.ecole_id, d.payeur_id, d.id,
  CASE
    WHEN p.type = 'particulier' AND (d.date_naissance IS NULL OR d.date_naissance > current_date - interval '18 years')
      THEN 'representant_legal'::type_lien
    ELSE 'autre'::type_lien
  END,
  true
FROM danseur d
JOIN payeur p ON p.id = d.payeur_id;--> statement-breakpoint

-- Contacts d'urgence saisis en texte. Même téléphone que le payeur : c'est lui,
-- son lien est marqué « contact d'urgence ». Sinon : une personne liée, marquée.
UPDATE lien SET contact_urgence = true
FROM danseur d
JOIN payeur p ON p.id = d.payeur_id
WHERE lien.personne_id = p.id AND lien.lie_a_id = d.id
  AND regexp_replace(coalesce(d.telephone_urgence, ''), '[^0-9]', '', 'g') <> ''
  AND regexp_replace(d.telephone_urgence, '[^0-9]', '', 'g') = regexp_replace(coalesce(p.telephone, ''), '[^0-9]', '', 'g');--> statement-breakpoint
CREATE TEMP TABLE urgence AS
SELECT gen_random_uuid() AS id, d.ecole_id, d.id AS danseur_id,
  coalesce(nullif(trim(d.contact_urgence), ''), 'Contact d''urgence') AS nom,
  nullif(trim(d.telephone_urgence), '') AS telephone
FROM danseur d
JOIN payeur p ON p.id = d.payeur_id
WHERE (nullif(trim(d.contact_urgence), '') IS NOT NULL OR nullif(trim(d.telephone_urgence), '') IS NOT NULL)
  AND regexp_replace(coalesce(d.telephone_urgence, ''), '[^0-9]', '', 'g')
      IS DISTINCT FROM nullif(regexp_replace(coalesce(p.telephone, ''), '[^0-9]', '', 'g'), '');--> statement-breakpoint
INSERT INTO personne (id, ecole_id, nom, telephone)
SELECT id, ecole_id, nom, telephone FROM urgence;--> statement-breakpoint
INSERT INTO lien (ecole_id, personne_id, lie_a_id, type, contact_urgence)
SELECT ecole_id, id, danseur_id, 'autre', true FROM urgence;--> statement-breakpoint
DROP TABLE urgence;
