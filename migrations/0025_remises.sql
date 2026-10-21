CREATE TYPE "public"."moyen_remise" AS ENUM('cheque', 'especes', 'cheque_vacances');--> statement-breakpoint
CREATE TABLE "remise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"date" date NOT NULL,
	"moyen" "moyen_remise" NOT NULL,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remise_ecole_id_id_unique" UNIQUE("ecole_id","id")
);
--> statement-breakpoint
CREATE TABLE "remise_paiement" (
	"ecole_id" uuid NOT NULL,
	"remise_id" uuid NOT NULL,
	"paiement_id" uuid NOT NULL,
	CONSTRAINT "remise_paiement_paiement_id_pk" PRIMARY KEY("paiement_id")
);
--> statement-breakpoint
ALTER TABLE "remise" ADD CONSTRAINT "remise_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remise" ADD CONSTRAINT "remise_cree_par_meme_ecole_fk" FOREIGN KEY ("ecole_id","cree_par") REFERENCES "public"."membre"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remise_paiement" ADD CONSTRAINT "remise_paiement_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remise_paiement" ADD CONSTRAINT "remise_paiement_remise_meme_ecole_fk" FOREIGN KEY ("ecole_id","remise_id") REFERENCES "public"."remise"("ecole_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remise_paiement" ADD CONSTRAINT "remise_paiement_paiement_meme_ecole_fk" FOREIGN KEY ("ecole_id","paiement_id") REFERENCES "public"."paiement"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "remise_paiement_remise_id_index" ON "remise_paiement" USING btree ("remise_id");--> statement-breakpoint
-- Isolation multi-école des remises en banque (modèle : 0001_rls.sql).
ALTER TABLE remise ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE remise FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON remise
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE remise_paiement ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE remise_paiement FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON remise_paiement
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);
