ALTER TABLE "paiement" ADD COLUMN "emetteur" text;--> statement-breakpoint
ALTER TABLE "paiement" ADD COLUMN "encaissement_prevu" date;--> statement-breakpoint
ALTER TABLE "paiement" ADD COLUMN "corrige_id" uuid;--> statement-breakpoint
ALTER TABLE "paiement" ADD CONSTRAINT "paiement_corrige_meme_ecole_fk" FOREIGN KEY ("ecole_id","corrige_id") REFERENCES "public"."paiement"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiement" ADD CONSTRAINT "paiement_montant" CHECK ("paiement"."montant_centimes" <> 0);