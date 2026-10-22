/**
 * Filtres par colonne des listes (élèves, contacts, intervenants) : lecture
 * et écriture dans l'adresse, et évaluation en mémoire. La traduction SQL
 * (`src/db/filtres.ts`) applique exactement les mêmes règles.
 *
 * Adresse : `?f=colonne.operateur.valeur` (répété) et `mode=ou` ; la valeur
 * peut contenir des points, seuls les deux premiers séparent.
 */

/** `date` : jour `YYYY-MM-DD` (date de naissance…). */
export type TypeColonne = "texte" | "nombre" | "telephone" | "date";

export type DefColonne = {
  id: string;
  libelle: string;
  type: TypeColonne;
  /** false : colonne proposée mais masquée tant que le membre ne l'affiche pas (#89). */
  parDefaut?: boolean;
  /** Nombres : alignés à droite. */
  droite?: boolean;
  /** false : colonne affichée mais sans filtre (montant mis en forme…). */
  filtrable?: boolean;
  /** Valeurs possibles : la colonne se filtre par cases à cocher (#107). La page peut en fournir (cours de la saison). */
  choix?: readonly string[];
  /** Colonne qui identifie la ligne (le nom) : toujours affichée, jamais masquable (#107). */
  obligatoire?: boolean;
  /** false : un clic sur le titre ne trie pas. */
  triable?: boolean;
  /** Adresse e-mail : affichée en lien `mailto:`. */
  courriel?: boolean;
  /** Texte d'une cellule vide (« l’élève » pour « Facturé à »), sinon un tiret. */
  siVide?: string;
};

export type Operateur =
  | "contient"
  | "ne_contient_pas"
  | "est"
  | "n_est_pas"
  | "commence"
  | "egal"
  | "different"
  | "sup"
  | "sup_egal"
  | "inf"
  | "inf_egal"
  | "vide"
  | "non_vide"
  | "parmi";

export type Condition = { colonne: string; operateur: Operateur; valeur: string };
export type Mode = "et" | "ou";
export type Filtre = { mode: Mode; conditions: Condition[] };

export const FILTRE_VIDE: Filtre = { mode: "et", conditions: [] };
/** Au-delà, la barre devient illisible et la requête inutilement lourde. */
export const CONDITIONS_MAX = 8;

const TEXTE: Operateur[] = ["contient", "ne_contient_pas", "est", "n_est_pas", "commence", "vide", "non_vide", "parmi"];
export const OPERATEURS: Record<TypeColonne, Operateur[]> = {
  texte: TEXTE,
  telephone: ["contient", "commence", "vide", "non_vide"],
  nombre: ["egal", "different", "sup", "sup_egal", "inf", "inf_egal", "vide", "non_vide"],
  date: ["egal", "inf", "sup", "inf_egal", "sup_egal", "vide", "non_vide"],
};

export const LIBELLES_OPERATEURS: Record<Operateur, string> = {
  contient: "contient",
  ne_contient_pas: "ne contient pas",
  est: "est",
  n_est_pas: "n’est pas",
  commence: "commence par",
  egal: "=",
  different: "≠",
  sup: ">",
  sup_egal: "≥",
  inf: "<",
  inf_egal: "≤",
  vide: "est vide",
  non_vide: "n’est pas vide",
  parmi: "est parmi",
};

/**
 * « parmi » (cases à cocher d'une colonne, #107) : valeurs séparées par `|`,
 * `(vide)` pour les lignes sans valeur. `Inscrit|(vide)` : inscrits ou sans inscription.
 */
export const VIDE = "(vide)";
export const SEPARATEUR = "|";
export const valeursParmi = (valeur: string) => valeur.split(SEPARATEUR).filter((v) => v.trim() !== "");

const LIBELLES_DATE: Partial<Record<Operateur, string>> = { egal: "le", inf: "avant le", sup: "après le", inf_egal: "jusqu’au", sup_egal: "depuis le" };

/** Libellé d'un opérateur selon le type de la colonne (« avant le » pour une date). */
export const libelleOperateur = (o: Operateur, type: TypeColonne) => (type === "date" && LIBELLES_DATE[o]) || LIBELLES_OPERATEURS[o];

export const sansValeur = (o: Operateur) => o === "vide" || o === "non_vide";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Correspondances d'accents, partagées avec la traduction SQL (`translate`). */
export const ACCENTS = "àâäáãåéèêëíìîïóòôöõúùûüçñÿ";
export const SANS_ACCENTS = "aaaaaaeeeeiiiiooooouuuucny";

/** Minuscules sans accents, espaces réduits. */
export function normaliserTexte(v: string): string {
  let r = "";
  for (const c of v.toLowerCase()) {
    const i = ACCENTS.indexOf(c);
    r += i === -1 ? c : SANS_ACCENTS[i];
  }
  return r.replace(/\s+/g, " ").trim();
}

export const chiffres = (v: string) => v.replace(/\D/g, "");

/** Nombre saisi (virgule ou point) ; null si ce n'est pas un nombre. */
export function lireNombre(v: string): number | null {
  const t = v.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Valeur exploitable pour cette condition, ou null si elle doit être ignorée. */
export function valeurNormalisee(c: Condition, type: TypeColonne): string | number | null {
  if (sansValeur(c.operateur)) return "";
  if (type === "nombre") return lireNombre(c.valeur);
  if (type === "date") return DATE.test(c.valeur.trim()) ? c.valeur.trim() : null;
  if (c.operateur === "parmi") {
    const vs = valeursParmi(c.valeur).map((x) => (x === VIDE ? VIDE : normaliserTexte(x)));
    return vs.length ? vs.join(SEPARATEUR) : null;
  }
  const v = type === "telephone" ? chiffres(c.valeur) : normaliserTexte(c.valeur);
  return v === "" ? null : v;
}

/** Conditions valides de l'adresse : colonne connue, opérateur adapté, valeur exploitable. */
export function lireFiltre(f: string | string[] | undefined | null, mode: string | string[] | undefined | null, colonnes: DefColonne[]): Filtre {
  const brutes = (Array.isArray(f) ? f : f ? [f] : []).slice(0, CONDITIONS_MAX);
  const conditions: Condition[] = [];
  for (const b of brutes) {
    const i = b.indexOf(".");
    const j = i === -1 ? -1 : b.indexOf(".", i + 1);
    const colonne = i === -1 ? b : b.slice(0, i);
    const operateur = (i === -1 ? "" : j === -1 ? b.slice(i + 1) : b.slice(i + 1, j)) as Operateur;
    const valeur = j === -1 ? "" : b.slice(j + 1);
    const def = colonnes.find((c) => c.id === colonne);
    if (!def || def.filtrable === false || !OPERATEURS[def.type].includes(operateur)) continue;
    const c = { colonne, operateur, valeur: sansValeur(operateur) ? "" : valeur };
    if (valeurNormalisee(c, def.type) !== null) conditions.push(c);
  }
  const m = Array.isArray(mode) ? mode[0] : mode;
  return { mode: m === "ou" ? "ou" : "et", conditions };
}

/** Paramètres d'adresse d'un filtre (le mode n'est écrit que s'il compte). */
export function versParametres(filtre: Filtre): [string, string][] {
  const p: [string, string][] = filtre.conditions.map((c) => [
    "f",
    sansValeur(c.operateur) ? `${c.colonne}.${c.operateur}` : `${c.colonne}.${c.operateur}.${c.valeur}`,
  ]);
  if (filtre.mode === "ou" && filtre.conditions.length > 1) p.push(["mode", "ou"]);
  return p;
}

/** Valeur d'une cellule : texte, nombre, liste (responsables…) ou absente. */
export type Cellule = string | number | string[] | null | undefined;

function evaluer(cellule: Cellule, c: Condition, type: TypeColonne): boolean {
  const v = valeurNormalisee(c, type);
  if (type === "nombre") {
    const n = typeof cellule === "number" ? cellule : null;
    if (c.operateur === "vide") return n === null;
    if (c.operateur === "non_vide") return n !== null;
    if (c.operateur === "different") return n !== v;
    if (n === null || typeof v !== "number") return false;
    switch (c.operateur) {
      case "egal":
        return n === v;
      case "sup":
        return n > v;
      case "sup_egal":
        return n >= v;
      case "inf":
        return n < v;
      case "inf_egal":
        return n <= v;
      default:
        return false;
    }
  }
  if (type === "date") {
    const d = typeof cellule === "string" && cellule !== "" ? cellule.slice(0, 10) : null;
    if (c.operateur === "vide") return d === null;
    if (c.operateur === "non_vide") return d !== null;
    if (d === null || typeof v !== "string") return false;
    switch (c.operateur) {
      case "egal":
        return d === v;
      case "inf":
        return d < v;
      case "sup":
        return d > v;
      case "inf_egal":
        return d <= v;
      case "sup_egal":
        return d >= v;
      default:
        return false;
    }
  }
  const brut = Array.isArray(cellule) ? cellule.join(", ") : cellule == null ? "" : String(cellule);
  const t = type === "telephone" ? chiffres(brut) : normaliserTexte(brut);
  const cible = String(v);
  switch (c.operateur) {
    case "vide":
      return t === "";
    case "non_vide":
      return t !== "";
    case "contient":
      return t.includes(cible);
    case "ne_contient_pas":
      return !t.includes(cible);
    // Une liste « est » X si l'un de ses éléments vaut X.
    case "est":
      return Array.isArray(cellule) ? cellule.some((e) => normaliserTexte(e) === cible) : t === cible;
    case "n_est_pas":
      return Array.isArray(cellule) ? !cellule.some((e) => normaliserTexte(e) === cible) : t !== cible;
    case "commence":
      return t.startsWith(cible);
    case "parmi": {
      const vs = cible.split(SEPARATEUR);
      if (t === "") return vs.includes(VIDE);
      return Array.isArray(cellule) ? cellule.some((e) => vs.includes(normaliserTexte(e))) : vs.includes(t);
    }
    default:
      return false;
  }
}

/** Lignes qui satisfont toutes (ET) ou au moins une (OU) des conditions. */
export function appliquerFiltre<T>(lignes: T[], filtre: Filtre, colonnes: (DefColonne & { valeur: (l: T) => Cellule })[]): T[] {
  const actives = filtre.conditions.flatMap((c) => {
    const def = colonnes.find((d) => d.id === c.colonne);
    return def ? [{ c, def }] : [];
  });
  if (actives.length === 0) return lignes;
  return lignes.filter((l) => {
    const r = actives.map(({ c, def }) => evaluer(def.valeur(l), c, def.type));
    return filtre.mode === "ou" ? r.some(Boolean) : r.every(Boolean);
  });
}

/** « Âge > 10 », « Responsables contient « Martin » », « Téléphone est vide » : pour les pastilles. */
export function libelleCondition(c: Condition, colonnes: DefColonne[]): string {
  const def = colonnes.find((d) => d.id === c.colonne);
  const op = libelleOperateur(c.operateur, def?.type ?? "texte");
  const nom = def?.libelle ?? c.colonne;
  if (sansValeur(c.operateur)) return `${nom} ${op}`;
  if (def?.type === "date") return `${nom} ${op} ${c.valeur.split("-").reverse().join("/")}`;
  return def?.type === "nombre" ? `${nom} ${op} ${c.valeur}` : `${nom} ${op} « ${c.valeur} »`;
}

/** Tri d'une liste par une colonne (#107), dans l'adresse : `?sort=age&order=desc`. */
export type Tri = { colonne: string; sens: "asc" | "desc" };

/** Tri de l'adresse s'il porte sur une colonne connue et triable ; sinon null (ordre par défaut). */
export function lireTri(sort: string | string[] | undefined | null, order: string | string[] | undefined | null, colonnes: DefColonne[]): Tri | null {
  const colonne = Array.isArray(sort) ? sort[0] : sort;
  const def = colonnes.find((c) => c.id === colonne);
  if (!def || def.triable === false) return null;
  return { colonne: def.id, sens: (Array.isArray(order) ? order[0] : order) === "desc" ? "desc" : "asc" };
}

/** Tri en mémoire, avec les règles du tri SQL : accents ignorés, nombres en ordre numérique, vides en dernier. */
export function trierLignes<L>(lignes: L[], tri: Tri | null, valeur: (l: L, colonne: string) => Cellule): L[] {
  if (!tri) return lignes;
  const cle = (v: Cellule) => (Array.isArray(v) ? v.join(", ") : v);
  const sens = tri.sens === "asc" ? 1 : -1;
  return [...lignes].sort((a, b) => {
    const x = cle(valeur(a, tri.colonne));
    const y = cle(valeur(b, tri.colonne));
    const xVide = x == null || x === "";
    const yVide = y == null || y === "";
    if (xVide || yVide) return xVide === yVide ? 0 : xVide ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sens;
    return normaliserTexte(String(x)).localeCompare(normaliserTexte(String(y)), "fr", { numeric: true }) * sens;
  });
}
