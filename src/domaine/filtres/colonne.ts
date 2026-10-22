import { type Condition, type DefColonne, type Filtre, SEPARATEUR, VIDE, valeursParmi } from "./filtres";

/**
 * Filtre d'une colonne tel que le montre le menu de son titre (#107), comme
 * dans Excel : des cases à cocher pour une colonne à valeurs connues
 * (inscription, cours, statut), « de … à … » pour un nombre ou une date,
 * « contient » pour un texte. Il s'écrit en conditions ordinaires de
 * l'adresse (`?f=…`), filtrées par le serveur.
 */
export type FiltreColonne = {
  /** Valeurs cochées (`VIDE` : sans valeur) ; null : pas de filtre par cases. */
  choix: string[] | null;
  /** Texte recherché dans la colonne. */
  texte: string;
  /** Bornes incluses d'un nombre ou d'une date (`YYYY-MM-DD`). */
  min: string;
  max: string;
  /** Conditions de l'adresse que le menu ne sait pas montrer (anciens liens) : affichées telles quelles. */
  autres: Condition[];
};

/** Filtre de la colonne `def` lu dans le filtre de la liste. */
export function lireFiltreColonne(filtre: Filtre, def: DefColonne): FiltreColonne {
  const r: FiltreColonne = { choix: null, texte: "", min: "", max: "", autres: [] };
  const borne = def.type === "nombre" || def.type === "date";
  for (const c of filtre.conditions) {
    if (c.colonne !== def.id) continue;
    if (c.operateur === "parmi" && r.choix === null) r.choix = valeursParmi(c.valeur);
    else if (c.operateur === "contient" && !borne && r.texte === "") r.texte = c.valeur;
    else if (c.operateur === "sup_egal" && borne && r.min === "") r.min = c.valeur;
    else if (c.operateur === "inf_egal" && borne && r.max === "") r.max = c.valeur;
    else r.autres.push(c);
  }
  return r;
}

/**
 * Filtre de la liste où la colonne `def` porte `fc` : ses conditions sont
 * remplacées, celles des autres colonnes gardées. Les colonnes filtrées se
 * cumulent (mode ET).
 */
export function ecrireFiltreColonne(filtre: Filtre, def: DefColonne, fc: Partial<FiltreColonne>): Filtre {
  const conditions = filtre.conditions.filter((c) => c.colonne !== def.id);
  const ajouter = (operateur: Condition["operateur"], valeur: string) =>
    conditions.push({ colonne: def.id, operateur, valeur });
  if (fc.choix && fc.choix.length > 0) ajouter("parmi", fc.choix.join(SEPARATEUR));
  if (fc.texte?.trim()) ajouter("contient", fc.texte);
  if (fc.min?.trim()) ajouter("sup_egal", fc.min.trim());
  if (fc.max?.trim()) ajouter("inf_egal", fc.max.trim());
  conditions.push(...(fc.autres ?? []));
  return { mode: "et", conditions };
}

const date = (v: string) => v.split("-").reverse().join("/");

/**
 * Résumé du filtre d'une colonne, pour la pastille au-dessus du tableau :
 * « Inscription : Inscrit, aucune », « Âge : de 3 à 17 », « Élève : contient « mart » ».
 * null sans filtre (les conditions `autres` ont leur propre pastille).
 */
export function resumeFiltreColonne(def: DefColonne, fc: FiltreColonne): string | null {
  const parties: string[] = [];
  if (fc.choix && fc.choix.length > 0)
    parties.push(fc.choix.map((v) => (v === VIDE ? (def.siVide ?? "vide") : v)).join(", "));
  if (fc.texte.trim()) parties.push(`contient « ${fc.texte.trim()} »`);
  const [min, max] = def.type === "date" ? [date(fc.min.trim()), date(fc.max.trim())] : [fc.min.trim(), fc.max.trim()];
  if (min && max) parties.push(def.type === "date" ? `du ${min} au ${max}` : `de ${min} à ${max}`);
  else if (min) parties.push(def.type === "date" ? `depuis le ${min}` : `${min} et plus`);
  else if (max) parties.push(def.type === "date" ? `jusqu’au ${max}` : `jusqu’à ${max}`);
  return parties.length ? `${def.libelle} : ${parties.join(", ")}` : null;
}
