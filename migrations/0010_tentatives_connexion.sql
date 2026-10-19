CREATE TABLE "tentative_connexion" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cle" text NOT NULL,
	"quand" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tentative_connexion_cle_quand_index" ON "tentative_connexion" USING btree ("cle","quand");