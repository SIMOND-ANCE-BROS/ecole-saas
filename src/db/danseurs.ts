import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { cours, danseur, discipline, documentDanseur, inscription, inscriptionCours, payeur, saison } from "./schema";

/** Fiche danseur, toujours avec la transaction d'`avecEcole()` (RLS). */

const texteFacultatif = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const saisieDanseurValide = z.object({
  prenom: z.string().trim().min(1, "Prénom obligatoire").max(100),
  nom: z.string().trim().min(1, "Nom obligatoire").max(100),
  dateNaissance: z
    .union([z.literal(""), z.iso.date("Date invalide")])
    .nullable()
    .transform((v) => v || null),
  contactUrgence: texteFacultatif(200),
  telephoneUrgence: texteFacultatif(30),
  notes: texteFacultatif(2000),
});

export type SaisieDanseur = z.output<typeof saisieDanseurValide>;
export type Resultat = { ok: true; id: string } | { ok: false; message: string };

export type FicheDanseur = SaisieDanseur & {
  id: string;
  famille: { id: string; nom: string; telephone: string | null; email: string | null };
  /** Cours suivis, saison la plus récente d'abord. */
  cours: {
    id: string;
    saison: string;
    discipline: string;
    niveau: string | null;
    jourSemaine: number | null;
    heureDebut: string;
    statut: (typeof inscription.statut.enumValues)[number];
  }[];
  documents: { type: (typeof documentDanseur.type.enumValues)[number]; accorde: boolean; valideJusqu: string | null }[];
};

export async function lireDanseur(tx: Tx, id: string): Promise<FicheDanseur | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [d] = await tx
    .select({
      id: danseur.id,
      prenom: danseur.prenom,
      nom: danseur.nom,
      dateNaissance: danseur.dateNaissance,
      contactUrgence: danseur.contactUrgence,
      telephoneUrgence: danseur.telephoneUrgence,
      notes: danseur.notes,
      famille: {
        id: payeur.id,
        nom: sql<string>`coalesce(${payeur.raisonSociale}, ${payeur.nom})`,
        telephone: payeur.telephone,
        email: payeur.email,
      },
    })
    .from(danseur)
    .innerJoin(payeur, eq(payeur.id, danseur.payeurId))
    .where(eq(danseur.id, id));
  if (!d) return null;

  const suivis = await tx
    .select({
      id: cours.id,
      saison: saison.libelle,
      discipline: discipline.nom,
      niveau: cours.niveau,
      jourSemaine: cours.jourSemaine,
      heureDebut: cours.heureDebut,
      statut: inscription.statut,
    })
    .from(inscriptionCours)
    .innerJoin(inscription, eq(inscription.id, inscriptionCours.inscriptionId))
    .innerJoin(cours, eq(cours.id, inscriptionCours.coursId))
    .innerJoin(discipline, eq(discipline.id, cours.disciplineId))
    .innerJoin(saison, eq(saison.id, cours.saisonId))
    .where(eq(inscriptionCours.danseurId, id))
    .orderBy(desc(saison.dateDebut), sql`${cours.jourSemaine} NULLS LAST`, asc(cours.heureDebut));

  const documents = await tx
    .select({ type: documentDanseur.type, accorde: documentDanseur.accorde, valideJusqu: documentDanseur.valideJusqu })
    .from(documentDanseur)
    .where(eq(documentDanseur.danseurId, id))
    .orderBy(asc(documentDanseur.type));

  return { ...d, cours: suivis.map((c) => ({ ...c, heureDebut: c.heureDebut.slice(0, 5) })), documents };
}

/** Ajoute un danseur à une famille de l'école courante. */
export async function creerDanseur(tx: Tx, payeurId: string, saisie: SaisieDanseur): Promise<Resultat> {
  if (!z.uuid().safeParse(payeurId).success) return { ok: false, message: "Famille introuvable." };
  const [p] = await tx.select({ id: payeur.id }).from(payeur).where(eq(payeur.id, payeurId));
  if (!p) return { ok: false, message: "Famille introuvable." };
  const [{ id }] = await tx
    .insert(danseur)
    .values({ ...saisie, payeurId, ecoleId: sql`nullif(current_setting('app.ecole_id', true), '')::uuid` })
    .returning({ id: danseur.id });
  return { ok: true, id };
}

export async function modifierDanseur(tx: Tx, id: string, saisie: SaisieDanseur): Promise<Resultat> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Ce danseur n’existe plus." };
  const lignes = await tx.update(danseur).set(saisie).where(eq(danseur.id, id)).returning({ id: danseur.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Ce danseur n’existe plus." };
}
