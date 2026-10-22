import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { discipline, inscription, reduction, tarif, tarifCarnet } from "./schema";

/**
 * Grille tarifaire, réductions et carnets d'une saison (#80). Ce sont des
 * données de l'école : le moteur de tarif les reçoit telles quelles. Toujours
 * avec la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
export type Resultat = { ok: true; id: string } | { ok: false; message: string };

export const PUBLICS = ["enfant", "adulte", "couple", "etudiant"] as const;
export const PERIODICITES = ["trimestre", "annee", "unite"] as const;
export type Public = (typeof PUBLICS)[number];
export type Periodicite = (typeof PERIODICITES)[number];

// ---------------------------------------------------------------------------
// Grille
// ---------------------------------------------------------------------------

export type LigneGrille = {
  public: Public;
  /** Durées triées, en minutes. */
  combinaison: number[];
  disciplineId: string | null;
  discipline: string | null;
  /** Prix par périodicité (absent : pas de forfait pour cette périodicité). */
  prix: Partial<Record<Periodicite, { id: string; centimes: number; utilise: boolean }>>;
};

/** Lignes de la grille d'une saison, regroupées par public, combinaison et discipline ; des plus courtes aux plus longues. */
export async function grilleSaison(tx: Tx, saisonId: string): Promise<LigneGrille[]> {
  if (!estUuid(saisonId)) return [];
  const idTarif = sql`${tarif}.${sql.identifier("id")}`;
  const cases = await tx
    .select({
      id: tarif.id,
      public: tarif.public,
      periodicite: tarif.periodicite,
      combinaison: tarif.combinaison,
      disciplineId: tarif.disciplineId,
      discipline: discipline.nom,
      prixCentimes: tarif.prixCentimes,
      utilise: sql<boolean>`EXISTS (SELECT 1 FROM inscription i WHERE i.tarif_id = ${idTarif})`,
    })
    .from(tarif)
    .leftJoin(discipline, eq(discipline.id, tarif.disciplineId))
    .where(eq(tarif.saisonId, saisonId));

  const lignes = new Map<string, LigneGrille>();
  for (const c of cases) {
    const combinaison = [...c.combinaison].sort((a, b) => a - b);
    const cle = `${c.public}|${combinaison.join("+")}|${c.disciplineId ?? ""}`;
    const ligne = lignes.get(cle) ?? {
      public: c.public,
      combinaison,
      disciplineId: c.disciplineId,
      discipline: c.discipline,
      prix: {},
    };
    ligne.prix[c.periodicite] = { id: c.id, centimes: c.prixCentimes, utilise: c.utilise };
    lignes.set(cle, ligne);
  }
  const total = (l: LigneGrille) => l.combinaison.reduce((s, d) => s + d, 0);
  return [...lignes.values()].sort(
    (a, b) =>
      PUBLICS.indexOf(a.public) - PUBLICS.indexOf(b.public) ||
      Number(a.disciplineId !== null) - Number(b.disciplineId !== null) ||
      a.combinaison.length - b.combinaison.length ||
      total(a) - total(b) ||
      a.combinaison.join("+").localeCompare(b.combinaison.join("+")) ||
      (a.discipline ?? "").localeCompare(b.discipline ?? ""),
  );
}

export const caseValide = z.object({
  public: z.enum(PUBLICS),
  combinaison: z.array(z.int().min(5).max(600)).min(1, "Indiquez au moins un cours").max(6),
  disciplineId: z.uuid().nullable(),
  periodicite: z.enum(PERIODICITES),
  /** null : retirer le prix de cette case. */
  prixCentimes: z.int().min(0).max(10_000_00).nullable(),
});

const memeCase = (saisonId: string, c: z.output<typeof caseValide>, combinaison: number[]) =>
  and(
    eq(tarif.saisonId, saisonId),
    eq(tarif.public, c.public),
    eq(tarif.periodicite, c.periodicite),
    sql`${tarif.combinaison} = ${`{${combinaison.join(",")}}`}::smallint[]`,
    c.disciplineId ? eq(tarif.disciplineId, c.disciplineId) : isNull(tarif.disciplineId),
  );

/**
 * Fixe (ou retire) le prix d'une case de la grille. Le prix d'une case déjà
 * utilisée peut changer (les inscriptions gardent le leur) ; elle ne peut pas
 * être retirée.
 */
export async function enregistrerPrix(tx: Tx, saisonId: string, saisie: z.input<typeof caseValide>): Promise<Resultat> {
  const c = caseValide.safeParse(saisie);
  if (!c.success) return { ok: false, message: c.error.issues[0].message };
  if (!estUuid(saisonId)) return { ok: false, message: "Saison introuvable." };
  const combinaison = [...c.data.combinaison].sort((a, b) => a - b);
  if (c.data.disciplineId) {
    const [d] = await tx.select({ id: discipline.id }).from(discipline).where(eq(discipline.id, c.data.disciplineId));
    if (!d) return { ok: false, message: "Discipline introuvable." };
  }
  const [existante] = await tx
    .select({ id: tarif.id })
    .from(tarif)
    .where(memeCase(saisonId, c.data, combinaison));

  if (c.data.prixCentimes === null) {
    if (!existante) return { ok: true, id: "" };
    const [utilisee] = await tx
      .select({ id: inscription.id })
      .from(inscription)
      .where(eq(inscription.tarifId, existante.id))
      .limit(1);
    if (utilisee)
      return { ok: false, message: "Ce prix sert déjà à des inscriptions : modifiez-le plutôt que de le retirer." };
    await tx.delete(tarif).where(eq(tarif.id, existante.id));
    return { ok: true, id: existante.id };
  }
  if (existante) {
    await tx.update(tarif).set({ prixCentimes: c.data.prixCentimes }).where(eq(tarif.id, existante.id));
    return { ok: true, id: existante.id };
  }
  const [{ id }] = await tx
    .insert(tarif)
    .values({
      ecoleId: ECOLE_COURANTE,
      saisonId,
      public: c.data.public,
      periodicite: c.data.periodicite,
      combinaison,
      disciplineId: c.data.disciplineId,
      prixCentimes: c.data.prixCentimes,
    })
    .returning({ id: tarif.id });
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Réductions (le moteur ne connaît que la fratrie)
// ---------------------------------------------------------------------------

export type Fratrie = {
  tauxPointsBase: number | null;
  montantCentimes: number | null;
  seuilDanseurs: number;
  publics: Public[];
  cumulableMultiDisciplines: boolean;
};

export async function lireFratrie(tx: Tx, saisonId: string): Promise<Fratrie | null> {
  if (!estUuid(saisonId)) return null;
  const [r] = await tx
    .select({
      tauxPointsBase: reduction.tauxPointsBase,
      montantCentimes: reduction.montantCentimes,
      seuilDanseurs: reduction.seuilDanseurs,
      publics: reduction.publics,
      cumulableMultiDisciplines: reduction.cumulableMultiDisciplines,
    })
    .from(reduction)
    .where(and(eq(reduction.saisonId, saisonId), eq(reduction.code, "fratrie")));
  return r ?? null;
}

export const fratrieValide = z
  .object({
    tauxPointsBase: z.int().min(1).max(10000).nullable(),
    montantCentimes: z.int().min(1).max(10_000_00).nullable(),
    seuilDanseurs: z.int().min(2).max(10),
    publics: z.array(z.enum(PUBLICS)),
    cumulableMultiDisciplines: z.boolean(),
  })
  .refine(
    (f) => (f.tauxPointsBase === null) !== (f.montantCentimes === null),
    "Indiquez un pourcentage ou un montant, pas les deux.",
  );

/** Règle de la réduction fratrie de la saison ; null la supprime. */
export async function enregistrerFratrie(
  tx: Tx,
  saisonId: string,
  saisie: z.input<typeof fratrieValide> | null,
): Promise<Resultat> {
  if (!estUuid(saisonId)) return { ok: false, message: "Saison introuvable." };
  if (saisie === null) {
    await tx.delete(reduction).where(and(eq(reduction.saisonId, saisonId), eq(reduction.code, "fratrie")));
    return { ok: true, id: saisonId };
  }
  const f = fratrieValide.safeParse(saisie);
  if (!f.success) return { ok: false, message: f.error.issues[0].message };
  await tx
    .insert(reduction)
    .values({ ...f.data, code: "fratrie", saisonId, ecoleId: ECOLE_COURANTE })
    .onConflictDoUpdate({ target: [reduction.saisonId, reduction.code], set: f.data });
  return { ok: true, id: saisonId };
}

// ---------------------------------------------------------------------------
// Carnets (cours particuliers)
// ---------------------------------------------------------------------------

export type LigneCarnet = { id: string; nbSeances: number; personnesMax: number; prixCentimes: number };

export function listerCarnets(tx: Tx, saisonId: string): Promise<LigneCarnet[]> {
  if (!estUuid(saisonId)) return Promise.resolve([]);
  return tx
    .select({
      id: tarifCarnet.id,
      nbSeances: tarifCarnet.nbSeances,
      personnesMax: tarifCarnet.personnesMax,
      prixCentimes: tarifCarnet.prixCentimes,
    })
    .from(tarifCarnet)
    .where(eq(tarifCarnet.saisonId, saisonId))
    .orderBy(asc(tarifCarnet.personnesMax), asc(tarifCarnet.nbSeances));
}

export const carnetValide = z.object({
  nbSeances: z.int().min(1).max(100),
  personnesMax: z.int().min(1).max(20),
  prixCentimes: z.int().min(0).max(10_000_00),
});

/** Crée ou met à jour le prix d'un carnet (séances, personnes). */
export async function enregistrerCarnet(
  tx: Tx,
  saisonId: string,
  saisie: z.input<typeof carnetValide>,
): Promise<Resultat> {
  const c = carnetValide.safeParse(saisie);
  if (!c.success) return { ok: false, message: c.error.issues[0].message };
  if (!estUuid(saisonId)) return { ok: false, message: "Saison introuvable." };
  const [{ id }] = await tx
    .insert(tarifCarnet)
    .values({ ...c.data, saisonId, ecoleId: ECOLE_COURANTE })
    .onConflictDoUpdate({
      target: [tarifCarnet.saisonId, tarifCarnet.nbSeances, tarifCarnet.personnesMax],
      set: { prixCentimes: c.data.prixCentimes },
    })
    .returning({ id: tarifCarnet.id });
  return { ok: true, id };
}

export async function supprimerCarnet(tx: Tx, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Ce carnet n’existe plus." };
  const lignes = await tx.delete(tarifCarnet).where(eq(tarifCarnet.id, id)).returning({ id: tarifCarnet.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Ce carnet n’existe plus." };
}
