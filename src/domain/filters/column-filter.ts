import { type Condition, type ColumnDef, type Filter, SEPARATOR, EMPTY, amongValues } from "./filters";

/**
 * Filtre d'une colonne tel que le montre le menu de son titre (#107), comme
 * dans Excel : des cases à cocher pour une colonne à valeurs connues
 * (inscription, cours, statut), « de … à … » pour un nombre ou une date,
 * « contient » pour un texte. Il s'écrit en conditions ordinaires de
 * l'adresse (`?f=…`), filtrées par le serveur.
 */
export type ColumnFilter = {
  /** Valeurs cochées (`VIDE` : sans valeur) ; null : pas de filtre par cases. */
  choice: string[] | null;
  /** Texte recherché dans la colonne. */
  text: string;
  /** Bornes incluses d'un nombre ou d'une date (`YYYY-MM-DD`). */
  min: string;
  max: string;
  /** Conditions de l'adresse que le menu ne sait pas montrer (anciens liens) : affichées telles quelles. */
  otherConditions: Condition[];
};

/** Filtre de la colonne `def` lu dans le filtre de la liste. */
export function readColumnFilter(filter: Filter, def: ColumnDef): ColumnFilter {
  const r: ColumnFilter = { choice: null, text: "", min: "", max: "", otherConditions: [] };
  const bound = def.type === "nombre" || def.type === "date";
  for (const c of filter.conditions) {
    if (c.column !== def.id) continue;
    if (c.operator === "parmi" && r.choice === null) r.choice = amongValues(c.value);
    else if (c.operator === "contient" && !bound && r.text === "") r.text = c.value;
    else if (c.operator === "sup_egal" && bound && r.min === "") r.min = c.value;
    else if (c.operator === "inf_egal" && bound && r.max === "") r.max = c.value;
    else r.otherConditions.push(c);
  }
  return r;
}

/**
 * Filtre de la liste où la colonne `def` porte `fc` : ses conditions sont
 * remplacées, celles des autres colonnes gardées. Les colonnes filtrées se
 * cumulent (mode ET).
 */
export function writeColumnFilter(filter: Filter, def: ColumnDef, fc: Partial<ColumnFilter>): Filter {
  const conditions = filter.conditions.filter((c) => c.column !== def.id);
  const add = (operator: Condition["operator"], value: string) => conditions.push({ column: def.id, operator, value });
  if (fc.choice && fc.choice.length > 0) add("parmi", fc.choice.join(SEPARATOR));
  if (fc.text?.trim()) add("contient", fc.text);
  if (fc.min?.trim()) add("sup_egal", fc.min.trim());
  if (fc.max?.trim()) add("inf_egal", fc.max.trim());
  conditions.push(...(fc.otherConditions ?? []));
  return { mode: "et", conditions };
}

const date = (v: string) => v.split("-").reverse().join("/");

/**
 * Résumé du filtre d'une colonne, pour la pastille au-dessus du tableau :
 * « Inscription : Inscrit, aucune », « Âge : de 3 à 17 », « Élève : contient « mart » ».
 * null sans filtre (les conditions `autres` ont leur propre pastille).
 */
export function columnFilterSummary(def: ColumnDef, fc: ColumnFilter): string | null {
  const parties: string[] = [];
  if (fc.choice && fc.choice.length > 0)
    parties.push(fc.choice.map((v) => (v === EMPTY ? (def.ifEmpty ?? "vide") : v)).join(", "));
  if (fc.text.trim()) parties.push(`contient « ${fc.text.trim()} »`);
  const [min, max] = def.type === "date" ? [date(fc.min.trim()), date(fc.max.trim())] : [fc.min.trim(), fc.max.trim()];
  if (min && max) parties.push(def.type === "date" ? `du ${min} au ${max}` : `de ${min} à ${max}`);
  else if (min) parties.push(def.type === "date" ? `depuis le ${min}` : `${min} et plus`);
  else if (max) parties.push(def.type === "date" ? `jusqu’au ${max}` : `jusqu’à ${max}`);
  return parties.length ? `${def.label} : ${parties.join(", ")}` : null;
}
