CREATE TYPE "public"."type_invitation" AS ENUM('invitation', 'reinitialisation');--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"type" "type_invitation" NOT NULL,
	"email" text NOT NULL,
	"nom" text,
	"role" "role_membre",
	"user_id" text,
	"jeton_hash" text NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	"cree_par" uuid,
	"utilise_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_jeton_hash_unique" UNIQUE("jeton_hash"),
	CONSTRAINT "invitation_contenu" CHECK (("invitation"."type" = 'invitation' AND "invitation"."role" IS NOT NULL) OR ("invitation"."type" = 'reinitialisation' AND "invitation"."user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_cree_par_meme_ecole_fk" FOREIGN KEY ("ecole_id","cree_par") REFERENCES "public"."membre"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Isolation multi-école des invitations (modèle : 0001_rls.sql).
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE invitation FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY isolation_ecole ON invitation
  USING (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid)
  WITH CHECK (ecole_id = nullif(current_setting('app.ecole_id', true), '')::uuid);
