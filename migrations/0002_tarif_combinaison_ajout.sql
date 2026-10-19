ALTER TABLE "reduction" ADD COLUMN "seuil_danseurs" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reduction" ADD COLUMN "publics" "public_tarif"[] DEFAULT '{}'::public_tarif[] NOT NULL;--> statement-breakpoint
ALTER TABLE "reduction" ADD COLUMN "cumulable_multi_disciplines" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tarif" ADD COLUMN "combinaison" smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tarif" ADD COLUMN "discipline_id" uuid;--> statement-breakpoint
ALTER TABLE "tarif" ADD CONSTRAINT "tarif_discipline_id_discipline_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."discipline"("id") ON DELETE no action ON UPDATE no action;