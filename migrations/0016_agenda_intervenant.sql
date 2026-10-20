ALTER TABLE "intervenant" ADD COLUMN "jeton_agenda_hash" text;--> statement-breakpoint
ALTER TABLE "intervenant" ADD COLUMN "jeton_agenda_cree_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intervenant" ADD CONSTRAINT "intervenant_jeton_agenda_hash_unique" UNIQUE("jeton_agenda_hash");