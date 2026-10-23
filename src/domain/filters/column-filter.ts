import { type Condition, type ColumnDef, type Filter, SEPARATOR, EMPTY, amongValues } from "./filters";

/**
 * A column's filter as shown by its header menu (#107), as in Excel:
 * checkboxes for a column with known values (enrollment, course, status),
 * « de … à … » for a number or a date, « contient » for text. It is written
 * as ordinary URL conditions (`?f=…`), filtered by the server.
 */
export type ColumnFilter = {
  /** Checked values (`EMPTY`: no value); null: no checkbox filter. */
  choice: string[] | null;
  /** Text searched in the column. */
  text: string;
  /** Inclusive bounds of a number or a date (`YYYY-MM-DD`). */
  min: string;
  max: string;
  /** URL conditions the menu cannot show (old links): displayed as they are. */
  otherConditions: Condition[];
};

/** Filter of column `def`, read from the list's filter. */
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
 * List filter where column `def` carries `fc`: its conditions are replaced,
 * those of the other columns kept. Filtered columns combine (AND mode).
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
 * Summary of a column's filter, for the chip above the table:
 * « Inscription : Inscrit, aucune », « Âge : de 3 à 17 », « Élève : contient « mart » ».
 * null without a filter (the `otherConditions` have their own chip).
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
