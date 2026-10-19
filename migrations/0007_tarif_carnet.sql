CREATE TABLE "tarif_carnet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecole_id" uuid NOT NULL,
	"saison_id" uuid NOT NULL,
	"nb_seances" smallint NOT NULL,
	"personnes_max" smallint NOT NULL,
	"prix_centimes" integer NOT NULL,
	CONSTRAINT "tarif_carnet_case_unique" UNIQUE("saison_id","nb_seances","personnes_max"),
	CONSTRAINT "tarif_carnet_valeurs" CHECK ("tarif_carnet"."nb_seances" >= 1 AND "tarif_carnet"."personnes_max" >= 1 AND "tarif_carnet"."prix_centimes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "carnet" DROP CONSTRAINT "carnet_personnes";--> statement-breakpoint
ALTER TABLE "tarif_carnet" ADD CONSTRAINT "tarif_carnet_ecole_id_ecole_id_fk" FOREIGN KEY ("ecole_id") REFERENCES "public"."ecole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarif_carnet" ADD CONSTRAINT "tarif_carnet_saison_meme_ecole_fk" FOREIGN KEY ("ecole_id","saison_id") REFERENCES "public"."saison"("ecole_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carnet" ADD CONSTRAINT "carnet_personnes" CHECK ("carnet"."nb_personnes" >= 1 AND "carnet"."seances_total" >= 1);