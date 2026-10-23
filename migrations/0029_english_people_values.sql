-- English values for the people enums (#114): only the labels change, stored
-- rows, the person_company_siren check and the person.type default follow
-- (enum constants are stored by reference, not by label).
ALTER TYPE "person_type" RENAME VALUE 'particulier' TO 'individual';--> statement-breakpoint
ALTER TYPE "person_type" RENAME VALUE 'professionnel' TO 'organisation';--> statement-breakpoint
ALTER TYPE "relationship_type" RENAME VALUE 'representant_legal' TO 'legal_guardian';--> statement-breakpoint
ALTER TYPE "relationship_type" RENAME VALUE 'conjoint' TO 'partner';--> statement-breakpoint
ALTER TYPE "relationship_type" RENAME VALUE 'autre' TO 'other';--> statement-breakpoint
ALTER TYPE "document_type" RENAME VALUE 'certificat_medical' TO 'medical_certificate';--> statement-breakpoint
ALTER TYPE "document_type" RENAME VALUE 'autorisation_parentale' TO 'parental_consent';--> statement-breakpoint
ALTER TYPE "document_type" RENAME VALUE 'droit_image' TO 'image_rights';--> statement-breakpoint
ALTER TYPE "document_type" RENAME VALUE 'autre' TO 'other';
