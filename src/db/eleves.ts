import { and, asc, eq, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { COLONNES_CONTACTS, COLONNES_ELEVES } from "../domaine/filtres/colonnes";
import { FILTRE_VIDE, type Filtre, type Tri } from "../domaine/filtres/filtres";
import { LIBELLES_STATUT_INSCRIPTION, PRIORITE_STATUT } from "../domaine/inscription/statuts";
import { JOURS_COURTS } from "../domaine/planning/jours";
import { aujourdhuiAParis } from "../domaine/personnes/age";
import { conditionFiltre, ordreColonne } from "./filtres";
import type { Tx } from "./index";
import {
  ajouterLien,
  conditionRecherche,
  creerPersonne,
  danseursPayables,
  type Doublon,
  doublonsProbables,
  type FichePersonne,
  lirePersonne,
  type Resultat,
  type SaisiePersonne,
  saisiePersonneValide,
} from "./personnes";
import { lien, personne } from "./schema";

/**
 * Élèves et contacts (#77) : la même table `personne`, présentée en clair.
 * Un élève a des responsables, des personnes à prévenir et un payeur
 * (« facturé à ») ; un contact est un parent, un payeur ou un organisme.
 * Toujours avec la transaction d'`avecEcole()` (RLS).
 */

/** Lignes au plus dans une liste : au-delà, l'accueil affine la recherche ou filtre. */
export const RESULTATS_MAX = 200;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
const idCourant = sql`${personne}.${sql.identifier("id")}`;
const nomSql = (alias: string) =>
  sql`coalesce(${sql.identifier(alias)}.company_name, concat_ws(' ', ${sql.identifier(alias)}.first_name, ${sql.identifier(alias)}.last_name))`;

// ---------------------------------------------------------------------------
// Listes
// ---------------------------------------------------------------------------

export type LigneEleve = {
  id: string;
  prenom: string | null;
  nom: string;
  dateNaissance: string | null;
  /** Téléphone de l'élève, sinon celui d'un responsable à prévenir. */
  telephone: string | null;
  responsables: string[];
  /** Nom du payeur ; null quand l'élève paie lui-même (ou qu'aucun payeur n'est indiqué). */
  factureA: string | null;
  /** E-mail de l'élève, sinon celui d'un responsable. */
  email: string | null;
  /** Cours de la saison (inscriptions actives ou à l'essai) : « Jazz lun. 17:00 ». */
  cours: string[];
  /** Statut d'inscription de la saison (« Inscrit », « En attente »…), null sans inscription. */
  inscription: string | null;
  /** Personnes à prévenir : « Sophie Martin, 06 12 34 56 78 ». */
  prevenir: string[];
};

/**
 * Filtres par colonne (#87) ; `aujourdhui` (Paris) sert au calcul de l'âge,
 * `saisonId` aux colonnes « Cours suivis » et « Inscription » (#89).
 */
export type OptionsListe = { filtre?: Filtre; tri?: Tri | null; aujourdhui?: string; saisonId?: string | null };

// Colonnes calculées des listes : les mêmes expressions servent à l'affichage et aux filtres.
const telephoneEleve = sql<string | null>`coalesce(${personne.telephone}, (
  SELECT r.phone FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${idCourant} AND l.emergency_contact AND r.phone IS NOT NULL ORDER BY r.last_name LIMIT 1))`;
const responsablesEleve = sql<string[]>`coalesce((
  SELECT array_agg(${nomSql("r")} ORDER BY r.first_name) FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${idCourant} AND l.type = 'representant_legal'), '{}')`;
const factureAEleve = sql<string | null>`(
  SELECT ${nomSql("r")} FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${idCourant} AND l.pays_for ORDER BY r.last_name LIMIT 1)`;
const elevesDuContact = sql<string[]>`coalesce((
  SELECT array_agg(DISTINCT coalesce(e.first_name, e.last_name)) FROM relationship l JOIN person e ON e.id = l.related_person_id
  WHERE l.person_id = ${idCourant} AND e.is_student AND (l.type = 'representant_legal' OR l.pays_for)), '{}')`;

const emailEleve = sql<string | null>`coalesce(${personne.email}, (
  SELECT r.email FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${idCourant} AND l.type = 'representant_legal' AND r.email IS NOT NULL ORDER BY r.last_name LIMIT 1))`;
const prevenirEleve = sql<string[]>`coalesce((
  SELECT array_agg(concat_ws(', ', ${nomSql("r")}, r.phone) ORDER BY r.last_name) FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${idCourant} AND l.emergency_contact), '{}')`;

/** CASE SQL d'après une table de libellés (les libellés passent en paramètres). */
const libelles = (valeur: SQL, table: Record<string | number, string>) =>
  sql`CASE ${valeur} ${sql.join(
    Object.entries(table).map(([k, v]) => sql`WHEN ${k} THEN ${v}`),
    sql` `,
  )} END`;

/** Libellé court d'un cours `c` de discipline `d` : « Jazz lun. 17:00 ». */
const libelleCours = () =>
  sql`concat_ws(' ', d.name, ${libelles(sql`c.weekday::text`, Object.fromEntries(JOURS_COURTS.map((j, i) => [i, j] as const).slice(1)))}, to_char(c.start_time, 'HH24:MI'))`;

/** Cours suivis cette saison (inscriptions actives ou à l'essai), triés par jour et heure. */
function coursEleve(saisonId: string | null): SQL<string[]> {
  if (!saisonId) return sql<string[]>`'{}'::text[]`;
  return sql<string[]>`coalesce((
    SELECT array_agg(x.label ORDER BY x.jour NULLS LAST, x.heure) FROM (
      SELECT DISTINCT ${libelleCours()} AS label, c.weekday AS jour, c.start_time AS heure
      FROM enrollment_course ic
      JOIN enrollment i ON i.id = ic.enrollment_id
      JOIN course c ON c.id = ic.course_id
      JOIN discipline d ON d.id = c.discipline_id
      WHERE ic.student_id = ${idCourant} AND i.season_id = ${saisonId} AND i.status IN ('active', 'essai')
    ) x), '{}')`;
}

/** Libellés des cours de la saison, par jour et heure : les choix du bouton « Cours » de la liste (#107). */
export async function libellesCoursSaison(tx: Tx, saisonId: string): Promise<string[]> {
  const lignes = await tx.execute<{ label: string }>(sql`
    SELECT x.label FROM (
      SELECT DISTINCT ${libelleCours()} AS label, c.weekday AS jour, c.start_time AS heure
      FROM course c JOIN discipline d ON d.id = c.discipline_id
      WHERE c.season_id = ${saisonId}
    ) x ORDER BY x.jour NULLS LAST, x.heure, x.label`);
  return lignes.map((l) => l.label);
}

/** Statut d'inscription de la saison ; le plus favorable si l'élève en a plusieurs. */
function inscriptionEleve(saisonId: string | null): SQL<string | null> {
  if (!saisonId) return sql<string | null>`NULL::text`;
  return sql<string | null>`(
    SELECT ${libelles(sql`i.status::text`, LIBELLES_STATUT_INSCRIPTION)}
    FROM enrollment i JOIN enrollment_course ic ON ic.enrollment_id = i.id
    WHERE ic.student_id = ${idCourant} AND i.season_id = ${saisonId}
    ORDER BY array_position(${sql`ARRAY[${sql.join(
      PRIORITE_STATUT.map((st) => sql`${st}`),
      sql`, `,
    )}]::text[]`}, i.status::text) LIMIT 1)`;
}

/**
 * Élèves de l'école, par nom. La recherche porte sur l'élève et sur ses
 * proches (nom, téléphone…) : on retrouve un enfant par sa mère. Les filtres
 * par colonne s'appliquent en SQL, avant la limite de la liste.
 */
export async function listerEleves(
  tx: Tx,
  saisie = "",
  { filtre = FILTRE_VIDE, tri = null, aujourdhui = aujourdhuiAParis(), saisonId = null }: OptionsListe = {},
): Promise<LigneEleve[]> {
  const surEleve = conditionRecherche(saisie);
  const surProche = conditionRecherche(saisie, "r");
  if (saisie.trim() && !surEleve) return [];
  const valideSaison = saisonId && estUuid(saisonId) ? saisonId : null;
  const coursSaison = coursEleve(valideSaison);
  const statutSaison = inscriptionEleve(valideSaison);
  const expressions = {
    nom: { sql: nomSql("person") },
    age: { sql: sql`date_part('year', age(${aujourdhui}::date, ${personne.dateNaissance}))` },
    responsables: { sql: responsablesEleve, liste: true },
    facture: { sql: factureAEleve },
    telephone: { sql: telephoneEleve },
    naissance: { sql: sql`${personne.dateNaissance}` },
    email: { sql: emailEleve },
    cours: { sql: coursSaison, liste: true },
    inscription: { sql: statutSaison },
    prevenir: { sql: prevenirEleve, liste: true },
  };
  const surColonnes = conditionFiltre(filtre, COLONNES_ELEVES, expressions);
  const ordre = ordreColonne(tri, COLONNES_ELEVES, expressions);
  return tx
    .select({
      id: personne.id,
      prenom: personne.prenom,
      nom: personne.nom,
      dateNaissance: personne.dateNaissance,
      telephone: telephoneEleve,
      responsables: responsablesEleve,
      factureA: factureAEleve,
      email: emailEleve,
      cours: coursSaison,
      inscription: statutSaison,
      prevenir: prevenirEleve,
    })
    .from(personne)
    .where(
      and(
        eq(personne.eleve, true),
        surEleve
          ? or(
              surEleve,
              sql`EXISTS (SELECT 1 FROM relationship l JOIN person r ON r.id = l.person_id WHERE l.related_person_id = ${idCourant} AND ${surProche})`,
            )
          : undefined,
        surColonnes,
      ),
    )
    .orderBy(...(ordre ? [ordre] : []), asc(personne.nom), asc(personne.prenom))
    .limit(RESULTATS_MAX);
}

export type LigneContact = {
  id: string;
  type: "particulier" | "professionnel";
  nom: string;
  prenom: string | null;
  raisonSociale: string | null;
  telephone: string | null;
  email: string | null;
  /** Élèves dont la personne est responsable ou pour qui elle paie. */
  eleves: string[];
};

/** Contacts : qui n'est pas élève, ou qui est responsable ou payeur d'un élève. */
export async function listerContacts(
  tx: Tx,
  saisie = "",
  { filtre = FILTRE_VIDE, tri = null }: OptionsListe = {},
): Promise<LigneContact[]> {
  const condition = conditionRecherche(saisie);
  if (saisie.trim() && !condition) return [];
  const expressions = {
    nom: { sql: nomSql("person") },
    eleves: { sql: elevesDuContact, liste: true },
    telephone: { sql: sql`${personne.telephone}` },
    email: { sql: sql`${personne.email}` },
  };
  const surColonnes = conditionFiltre(filtre, COLONNES_CONTACTS, expressions);
  const ordre = ordreColonne(tri, COLONNES_CONTACTS, expressions);
  return tx
    .select({
      id: personne.id,
      type: personne.type,
      nom: personne.nom,
      prenom: personne.prenom,
      raisonSociale: personne.raisonSociale,
      telephone: personne.telephone,
      email: personne.email,
      eleves: elevesDuContact,
    })
    .from(personne)
    .where(
      and(
        or(
          eq(personne.eleve, false),
          sql`EXISTS (SELECT 1 FROM relationship l WHERE l.person_id = ${idCourant} AND (l.type = 'representant_legal' OR l.pays_for))`,
        ),
        condition ?? undefined,
        surColonnes,
      ),
    )
    .orderBy(...(ordre ? [ordre] : []), asc(personne.nom), asc(personne.prenom))
    .limit(RESULTATS_MAX);
}

// ---------------------------------------------------------------------------
// Fiches
// ---------------------------------------------------------------------------

export type ProcheEleve = {
  lienId: string;
  id: string;
  nom: string;
  telephone: string | null;
  email: string | null;
  aPrevenir: boolean;
  paie: boolean;
  relation: "responsable" | "conjoint" | "autre";
  /** « vers » : ce proche est <relation> de l'élève ; « de » : l'élève est <relation> de ce proche. */
  sens: "de" | "vers";
};

export type FicheEleve = Omit<FichePersonne, "liens"> & {
  eleve: boolean;
  responsables: ProcheEleve[];
  autres: ProcheEleve[];
  /** Qui reçoit les factures : l'élève lui-même, une personne, ou personne d'indiqué (mineur sans payeur). */
  factureA: { type: "eleve" } | { type: "personne"; id: string; nom: string } | { type: "aucun" };
  /** Autres élèves du même payeur (réduction fratrie). */
  fratrie: { id: string; prenom: string }[];
};

const majeur = (dateNaissance: string | null, aujourdhui: string) => {
  if (!dateNaissance) return true;
  const [a, m, j] = dateNaissance.split("-").map(Number);
  const [aa, mm, jj] = aujourdhui.split("-").map(Number);
  return aa - a - (mm < m || (mm === m && jj < j) ? 1 : 0) >= 18;
};

export async function lireEleve(tx: Tx, id: string, aujourdhui: string): Promise<FicheEleve | null> {
  const p = await lirePersonne(tx, id);
  if (!p) return null;
  const [{ eleve }] = await tx.select({ eleve: personne.eleve }).from(personne).where(eq(personne.id, id));
  const proche = (l: FichePersonne["liens"][number]): ProcheEleve => ({
    lienId: l.id,
    id: l.autre.id,
    nom: l.autre.nom,
    telephone: l.autre.telephone,
    email: l.autre.email,
    aPrevenir: l.contactUrgence,
    paie: l.paiePour,
    relation: l.type === "representant_legal" ? "responsable" : l.type,
    sens: l.sens,
  });
  const vers = p.liens.filter((l) => l.sens === "vers");
  const payeur = vers.find((l) => l.paiePour);
  const factureA: FicheEleve["factureA"] = payeur
    ? { type: "personne", id: payeur.autre.id, nom: payeur.autre.nom }
    : majeur(p.dateNaissance, aujourdhui)
      ? { type: "eleve" }
      : { type: "aucun" };
  const fratrie =
    factureA.type === "personne"
      ? (await danseursPayables(tx, factureA.id))
          .filter((d) => d.id !== id && d.id !== factureA.id)
          .map((d) => ({ id: d.id, prenom: d.prenom }))
      : [];
  const { liens, ...reste } = p;
  return {
    ...reste,
    eleve,
    responsables: vers.filter((l) => l.type === "representant_legal").map(proche),
    // Les autres proches, et les liens enregistrés depuis l'élève (dont il est responsable, conjoint saisi de son côté).
    autres: liens.filter((l) => l.sens === "de" || l.type !== "representant_legal").map(proche),
    factureA,
    fratrie,
  };
}

export type FicheContact = Omit<FichePersonne, "liens"> & {
  eleve: boolean;
  /** Élèves dont la personne est responsable, qu'elle prévient ou pour qui elle paie. */
  eleves: { lienId: string; id: string; nom: string; responsable: boolean; paie: boolean; aPrevenir: boolean }[];
};

export async function lireContact(tx: Tx, id: string): Promise<FicheContact | null> {
  const p = await lirePersonne(tx, id);
  if (!p) return null;
  const [{ eleve }] = await tx.select({ eleve: personne.eleve }).from(personne).where(eq(personne.id, id));
  const { liens, ...reste } = p;
  return {
    ...reste,
    eleve,
    eleves: liens
      .filter((l) => l.sens === "de")
      .map((l) => ({
        lienId: l.id,
        id: l.autre.id,
        nom: l.autre.nom,
        responsable: l.type === "representant_legal",
        paie: l.paiePour,
        aPrevenir: l.contactUrgence,
      })),
  };
}

// ---------------------------------------------------------------------------
// Création guidée d'un élève
// ---------------------------------------------------------------------------

export const autrePersonneValide = z.union([z.object({ id: z.uuid() }), z.object({ nouveau: saisiePersonneValide })]);

export const saisieEleveValide = z
  .object({
    eleve: saisiePersonneValide,
    responsable: autrePersonneValide.nullable(),
    aPrevenir: z.boolean(),
    facturation: z.union([
      z.object({ type: z.literal("eleve") }),
      z.object({ type: z.literal("responsable") }),
      z.object({ type: z.literal("autre"), payeur: autrePersonneValide }),
    ]),
  })
  .refine((s) => s.eleve.type === "particulier", { path: ["eleve"], message: "Un élève est un particulier." })
  .refine((s) => s.facturation.type !== "responsable" || s.responsable !== null, {
    path: ["facturation"],
    message: "Indiquez le responsable à facturer.",
  });

export type SaisieEleve = z.output<typeof saisieEleveValide>;
export type DoublonRole = Doublon & { role: "élève" | "responsable" | "payeur" };

async function resoudre(tx: Tx, p: z.output<typeof autrePersonneValide>): Promise<string | null> {
  if ("id" in p) {
    const [x] = await tx.select({ id: personne.id }).from(personne).where(eq(personne.id, p.id));
    return x?.id ?? null;
  }
  const r = await creerPersonne(tx, p.nouveau, true);
  return r.statut === "ok" ? r.id : null;
}

/** Erreur qui annule toute la création : rien n'est gardé à moitié. */
export class RefusCreation extends Error {}

/**
 * Crée l'élève, son responsable (existant ou nouveau) et son payeur en une
 * seule transaction. Sans `confirme`, renvoie d'abord les doublons probables
 * de chaque nouvelle personne.
 */
export async function creerEleve(
  tx: Tx,
  saisie: SaisieEleve,
  confirme: boolean,
): Promise<{ statut: "ok"; id: string } | { statut: "doublons"; doublons: DoublonRole[] }> {
  if (!confirme) {
    const nouvelles: [DoublonRole["role"], SaisiePersonne][] = [["élève", saisie.eleve]];
    if (saisie.responsable && "nouveau" in saisie.responsable)
      nouvelles.push(["responsable", saisie.responsable.nouveau]);
    if (saisie.facturation.type === "autre" && "nouveau" in saisie.facturation.payeur)
      nouvelles.push(["payeur", saisie.facturation.payeur.nouveau]);
    const doublons: DoublonRole[] = [];
    for (const [role, s] of nouvelles) doublons.push(...(await doublonsProbables(tx, s)).map((d) => ({ ...d, role })));
    if (doublons.length > 0) return { statut: "doublons", doublons };
  }

  const cree = await creerPersonne(tx, saisie.eleve, true);
  if (cree.statut !== "ok") throw new RefusCreation("Création impossible.");
  const id = cree.id;
  await tx.update(personne).set({ eleve: true }).where(eq(personne.id, id));

  if (saisie.responsable) {
    const responsableId = await resoudre(tx, saisie.responsable);
    if (!responsableId) throw new RefusCreation("Responsable introuvable.");
    const r = await ajouterLien(tx, {
      personneId: responsableId,
      lieAId: id,
      type: "representant_legal",
      contactUrgence: saisie.aPrevenir,
      paiePour: saisie.facturation.type === "responsable",
    });
    if (!r.ok) throw new RefusCreation(r.message);
  }
  if (saisie.facturation.type === "autre") {
    const payeurId = await resoudre(tx, saisie.facturation.payeur);
    if (!payeurId) throw new RefusCreation("Payeur introuvable.");
    const r = await definirFacturation(tx, id, { type: "personne", id: payeurId });
    if (!r.ok) throw new RefusCreation(r.message);
  }
  return { statut: "ok", id };
}

// ---------------------------------------------------------------------------
// Modifications depuis la fiche élève
// ---------------------------------------------------------------------------

/**
 * « Facturé à » : l'élève lui-même, ou une personne (responsable, proche,
 * organisme). Un seul payeur à la fois ; le lien est créé au besoin.
 */
export async function definirFacturation(
  tx: Tx,
  eleveId: string,
  cible: { type: "eleve" } | { type: "personne"; id: string },
): Promise<Resultat> {
  if (!estUuid(eleveId) || (cible.type === "personne" && (!estUuid(cible.id) || cible.id === eleveId))) {
    return { ok: false, message: "Choix de facturation invalide." };
  }
  const [e] = await tx.select({ id: personne.id }).from(personne).where(eq(personne.id, eleveId));
  if (!e) return { ok: false, message: "Cet élève n’existe plus." };
  await tx.update(lien).set({ paiePour: false }).where(eq(lien.lieAId, eleveId));
  if (cible.type === "eleve") return { ok: true, id: eleveId };

  const [direct] = await tx
    .select({ id: lien.id })
    .from(lien)
    .where(and(eq(lien.personneId, cible.id), eq(lien.lieAId, eleveId)));
  if (direct) {
    await tx.update(lien).set({ paiePour: true }).where(eq(lien.id, direct.id));
    return { ok: true, id: eleveId };
  }
  // Lien enregistré dans l'autre sens (conjoint saisi depuis la fiche de l'élève) : il est retourné.
  const [inverse] = await tx
    .select({ id: lien.id })
    .from(lien)
    .where(and(eq(lien.personneId, eleveId), eq(lien.lieAId, cible.id)));
  if (inverse) {
    await tx
      .update(lien)
      .set({ personneId: cible.id, lieAId: eleveId, paiePour: true, contactUrgence: false })
      .where(eq(lien.id, inverse.id));
    return { ok: true, id: eleveId };
  }
  const r = await ajouterLien(tx, {
    personneId: cible.id,
    lieAId: eleveId,
    type: "autre",
    contactUrgence: false,
    paiePour: true,
  });
  return r.ok ? { ok: true, id: eleveId } : r;
}

/** Ajoute un responsable légal (existant ou nouveau) ; un lien existant devient « responsable ». */
export async function ajouterResponsable(
  tx: Tx,
  eleveId: string,
  responsable: z.input<typeof autrePersonneValide>,
  aPrevenir: boolean,
): Promise<Resultat> {
  const r = autrePersonneValide.safeParse(responsable);
  if (!r.success || !estUuid(eleveId)) return { ok: false, message: "Saisie invalide." };
  const [e] = await tx.select({ id: personne.id }).from(personne).where(eq(personne.id, eleveId));
  if (!e) return { ok: false, message: "Cet élève n’existe plus." };
  const responsableId = await resoudre(tx, r.data);
  if (!responsableId || responsableId === eleveId) return { ok: false, message: "Responsable introuvable." };
  const [existant] = await tx
    .select({ id: lien.id })
    .from(lien)
    .where(and(eq(lien.personneId, responsableId), eq(lien.lieAId, eleveId)));
  if (existant) {
    await tx
      .update(lien)
      .set({ type: "representant_legal", contactUrgence: aPrevenir })
      .where(eq(lien.id, existant.id));
    return { ok: true, id: existant.id };
  }
  return ajouterLien(tx, {
    personneId: responsableId,
    lieAId: eleveId,
    type: "representant_legal",
    contactUrgence: aPrevenir,
    paiePour: false,
  });
}

/** Un contact devient élève (ou cesse de l'être). */
export async function marquerEleve(tx: Tx, id: string, eleve: boolean): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Personne introuvable." };
  const lignes = await tx.update(personne).set({ eleve }).where(eq(personne.id, id)).returning({ id: personne.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Personne introuvable." };
}

/** « À prévenir en cas d'urgence » pour un proche de l'élève. */
export async function changerPrevenir(tx: Tx, lienId: string, aPrevenir: boolean): Promise<Resultat> {
  if (!estUuid(lienId)) return { ok: false, message: "Ce lien n’existe plus." };
  const lignes = await tx
    .update(lien)
    .set({ contactUrgence: aPrevenir })
    .where(eq(lien.id, lienId))
    .returning({ id: lien.id });
  return lignes.length === 1 ? { ok: true, id: lienId } : { ok: false, message: "Ce lien n’existe plus." };
}

/** Élève ou contact : sert aux anciennes adresses /personnes/<id>. null si la personne n'existe pas. */
export async function estEleve(tx: Tx, id: string): Promise<boolean | null> {
  if (!estUuid(id)) return null;
  const [p] = await tx.select({ eleve: personne.eleve }).from(personne).where(eq(personne.id, id));
  return p ? p.eleve : null;
}

/** Facturer une personne connue ou créée à l'instant (organisme, autre proche). */
export async function facturerA(
  tx: Tx,
  eleveId: string,
  payeur: z.input<typeof autrePersonneValide>,
): Promise<Resultat> {
  const p = autrePersonneValide.safeParse(payeur);
  if (!p.success) return { ok: false, message: "Vérifiez les informations du payeur." };
  const id = await resoudre(tx, p.data);
  return id ? definirFacturation(tx, eleveId, { type: "personne", id }) : { ok: false, message: "Payeur introuvable." };
}
