"use client";

import Link from "next/link";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
import type { Liste } from "@/domaine/filtres/colonnes";
import { basculer, type Disposition, deplacer, dispositionParDefaut, ecrireDisposition, lireDisposition } from "@/domaine/filtres/disposition";
import { type Condition, CONDITIONS_MAX, type DefColonne, LIBELLES_OPERATEURS, libelleCondition, type Mode, OPERATEURS, sansValeur } from "@/domaine/filtres/filtres";
import { enregistrerColonnes } from "./actions";
import { type FiltreAdresse, useFiltreAdresse } from "./filtre-adresse";

export type ValeurCellule = string | number | string[] | null;
export type LigneTableau = {
  id: string;
  /** Lien de la colonne `lien` (fiche) ; absent : texte simple. */
  href?: string;
  /** Ligne grisée (intervenant inactif…). */
  attenue?: boolean;
  /** Petite étiquette après le nom (« inactif », « organisme »). */
  marque?: string;
  cellules: Record<string, ValeurCellule>;
};

type Props = {
  liste: Liste;
  /** « les élèves » : pour les libellés accessibles. */
  quoi: string;
  legende: string;
  colonnes: DefColonne[];
  /** Disposition enregistrée du membre, ou null. */
  disposition: string[] | null;
  lignes: LigneTableau[];
  /** Colonne qui porte le lien vers la fiche. */
  lien: string;
  /** Message quand aucune ligne ne s'affiche. */
  vide: string;
  /** Affichage propre au téléphone (le tableau y est masqué) ; les filtres restent dans « Colonnes ». */
  mobile?: ReactNode;
};

/**
 * Liste en tableau (#89) : un bouton de filtre dans chaque en-tête, un menu
 * « Colonnes » pour afficher, masquer et réordonner (mémorisé pour le membre)
 * et filtrer aussi les colonnes masquées. Les filtres vont dans l'adresse ;
 * la page filtre côté serveur et renvoie les lignes.
 */
export function TableauListe({ liste, quoi, legende, colonnes, disposition, lignes, lien, vide, mobile }: Props) {
  const f = useFiltreAdresse(colonnes);
  const [dispo, setDispo] = useState<Disposition>(() => lireDisposition(colonnes, disposition));
  const [enregistrement, demarrer] = useTransition();
  const [echec, setEchec] = useState(false);
  const defs = new Map(colonnes.map((c) => [c.id, c]));
  const visibles = dispo.filter((d) => d.visible).flatMap((d) => defs.get(d.id) ?? []);

  function changerDispo(d: Disposition) {
    setDispo(d);
    setEchec(false);
    demarrer(async () => setEchec(!(await enregistrerColonnes(liste, ecrireDisposition(d)))));
  }

  const completes = f.filtre.conditions.flatMap((c, i) => (f.complete(c) ? [{ c, i }] : []));
  const mode = (m: Mode) => f.changer({ ...f.filtre, mode: m });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Bulle titre={`Colonnes et filtres de ${quoi}`} bouton="Colonnes" classeBouton="bouton-secondaire" largeur="w-[22rem]">
          <MenuColonnes colonnes={defs} dispo={dispo} changer={changerDispo} f={f} parDefaut={() => changerDispo(dispositionParDefaut(colonnes))} />
        </Bulle>
        {completes.length > 1 && (
          <fieldset className="flex items-center gap-2">
            <legend className="sr-only">Combinaison des filtres</legend>
            {(["et", "ou"] as Mode[]).map((m) => (
              <label key={m} className="flex items-center gap-1">
                <input type="radio" name={`mode-${liste}`} checked={f.filtre.mode === m} onChange={() => mode(m)} />
                {m === "et" ? "toutes les conditions" : "au moins une"}
              </label>
            ))}
          </fieldset>
        )}
        <ul className="flex flex-wrap gap-1.5" aria-label="Filtres actifs">
          {completes.map(({ c, i }, k) => (
            <li key={i} className="flex items-center gap-1 rounded-full border border-accent bg-accent-doux py-0.5 pr-1 pl-2.5">
              {k > 0 && <span className="text-xs text-doux">{f.filtre.mode === "et" ? "et" : "ou"}</span>}
              {libelleCondition(c, colonnes)}
              <button type="button" className="rounded-full px-1.5 hover:bg-surface" aria-label={`Retirer le filtre ${libelleCondition(c, colonnes)}`} onClick={() => f.retirer(i)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        {completes.length > 0 && (
          <button type="button" className="lien" onClick={() => f.changer({ mode: "et", conditions: [] })}>
            Effacer les filtres
          </button>
        )}
        <span className="text-xs text-doux" role="status">
          {f.enCours ? "Filtrage…" : enregistrement ? "Enregistrement des colonnes…" : echec ? "Disposition non enregistrée : réessayez." : ""}
        </span>
      </div>

      {mobile && <div className="sm:hidden">{mobile}</div>}
      <div className={`panneau overflow-x-auto ${mobile ? "hidden sm:block" : ""}`}>
        <table className="tableau">
          <caption className="sr-only">{legende}</caption>
          <thead>
            <tr>
              {visibles.map((d) => (
                <th key={d.id} scope="col" className={d.droite ? "text-right" : ""}>
                  <span className={`inline-flex items-center gap-1 ${d.droite ? "flex-row-reverse" : ""}`}>
                    {d.libelle}
                    {d.filtrable !== false && <BulleFiltre def={d} f={f} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 ? (
              <tr>
                <td colSpan={visibles.length} className="py-3 text-doux">
                  {vide}
                </td>
              </tr>
            ) : (
              lignes.map((l) => (
                <tr key={l.id} className={l.attenue ? "text-doux" : ""}>
                  {visibles.map((d) => (
                    <td key={d.id} className={d.droite ? "text-right tabular-nums" : ""}>
                      {d.id === lien ? (
                        <>
                          {l.href ? (
                            <Link href={l.href} data-resultat className="lien font-medium">
                              {texte(l.cellules[d.id])}
                            </Link>
                          ) : (
                            <span className="font-medium">{texte(l.cellules[d.id])}</span>
                          )}
                          {l.marque && <span className="ml-2 rounded border border-bordure px-1.5 text-xs font-normal text-doux">{l.marque}</span>}
                        </>
                      ) : (
                        <Cellule def={d} valeur={l.cellules[d.id]} />
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const texte = (v: ValeurCellule) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

function Cellule({ def, valeur }: { def: DefColonne; valeur: ValeurCellule }) {
  const t = texte(valeur);
  if (t === "") return <span className="text-doux">{def.siVide ?? "—"}</span>;
  if (def.type === "telephone") {
    return (
      <a href={`tel:${t.replace(/\s/g, "")}`} className="lien whitespace-nowrap tabular-nums">
        {t}
      </a>
    );
  }
  if (def.courriel) {
    return (
      <a href={`mailto:${t}`} className="lien break-all">
        {t}
      </a>
    );
  }
  return t;
}

/**
 * Bulle native (`popover`) : au-dessus de tout, fermée par Échap ou un clic
 * ailleurs, le focus revient au bouton. Placée sous son bouton à l'ouverture.
 */
function Bulle({
  titre,
  bouton,
  classeBouton,
  libelleBouton,
  largeur = "w-80",
  surOuverture,
  surFermeture,
  children,
}: {
  titre: string;
  bouton: ReactNode;
  classeBouton: string;
  libelleBouton?: string;
  largeur?: string;
  surOuverture?: () => void;
  surFermeture?: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const declencheur = useRef<HTMLButtonElement>(null);
  const bulle = useRef<HTMLDivElement>(null);

  function placer() {
    const b = declencheur.current?.getBoundingClientRect();
    const p = bulle.current;
    if (!b || !p) return;
    const gauche = Math.max(8, Math.min(b.left, window.innerWidth - p.offsetWidth - 8));
    const haut = b.bottom + 4 + p.offsetHeight > window.innerHeight - 8 ? Math.max(8, b.top - 4 - p.offsetHeight) : b.bottom + 4;
    p.style.left = `${gauche}px`;
    p.style.top = `${haut}px`;
  }

  return (
    <>
      <button ref={declencheur} type="button" popoverTarget={id} className={classeBouton} aria-label={libelleBouton}>
        {bouton}
      </button>
      <div
        ref={bulle}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={titre}
        className={`panneau fixed m-0 max-h-[70vh] max-w-[calc(100vw-1rem)] overflow-y-auto p-3 text-sm font-normal text-texte shadow-lg [inset:auto] ${largeur}`}
        onToggle={(e) => {
          if (e.newState === "open") {
            surOuverture?.();
            placer();
            requestAnimationFrame(() => {
              placer();
              bulle.current?.querySelector<HTMLElement>("select, input, button")?.focus();
            });
          } else surFermeture?.();
        }}
      >
        {children}
      </div>
    </>
  );
}

/** Bouton de filtre d'un en-tête : indique combien de conditions portent sur la colonne. */
function BulleFiltre({ def, f }: { def: DefColonne; f: FiltreAdresse }) {
  const n = f.filtre.conditions.filter((c) => c.colonne === def.id && f.complete(c)).length;
  return (
    <Bulle
      titre={`Filtrer « ${def.libelle} »`}
      libelleBouton={`Filtrer « ${def.libelle} »${n ? ` (${n} condition${n > 1 ? "s" : ""})` : ""}`}
      bouton={
        <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill={n ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
          <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" strokeLinejoin="round" />
        </svg>
      }
      classeBouton={`rounded p-1 hover:bg-accent-doux ${n ? "text-accent" : "text-doux"}`}
      surOuverture={() => {
        if (!f.filtre.conditions.some((c) => c.colonne === def.id)) f.ajouter(def.id);
      }}
      surFermeture={() => f.nettoyer(def.id)}
    >
      <p className="mb-2 font-medium">{def.libelle}</p>
      <ConditionsColonne def={def} f={f} />
    </Bulle>
  );
}

/** Conditions portant sur une colonne : opérateur, valeur, retrait ; ajout d'une autre. */
function ConditionsColonne({ def, f }: { def: DefColonne; f: FiltreAdresse }) {
  const lignes = f.filtre.conditions.flatMap((c, i) => (c.colonne === def.id ? [{ c, i }] : []));
  return (
    <div className="flex flex-col gap-2">
      {lignes.map(({ c, i }, k) => (
        <LigneCondition key={i} def={def} c={c} rang={k + 1} f={f} i={i} />
      ))}
      <button type="button" className="lien self-start text-sm" disabled={f.filtre.conditions.length >= CONDITIONS_MAX} onClick={() => f.ajouter(def.id)}>
        {lignes.length === 0 ? "Ajouter une condition" : "Ajouter une autre condition"}
      </button>
    </div>
  );
}

function LigneCondition({ def, c, rang, f, i }: { def: DefColonne; c: Condition; rang: number; f: FiltreAdresse; i: number }) {
  const id = useId();
  const incomplete = !sansValeur(c.operateur) && c.valeur.trim() !== "" && !f.complete(c);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`${id}-op`}>
        Condition {rang} sur {def.libelle}
      </label>
      <select id={`${id}-op`} className="champ" value={c.operateur} onChange={(e) => f.modifier(i, { operateur: e.target.value as Condition["operateur"] })}>
        {OPERATEURS[def.type].map((o) => (
          <option key={o} value={o}>
            {LIBELLES_OPERATEURS[o]}
          </option>
        ))}
      </select>
      {!sansValeur(c.operateur) && (
        <>
          <label className="sr-only" htmlFor={`${id}-valeur`}>
            Valeur de la condition {rang} sur {def.libelle}
          </label>
          <input
            id={`${id}-valeur`}
            className="champ w-36"
            inputMode={def.type === "nombre" ? "decimal" : def.type === "telephone" ? "tel" : "text"}
            value={c.valeur}
            aria-invalid={incomplete || undefined}
            aria-describedby={incomplete ? `${id}-aide` : undefined}
            onChange={(e) => f.modifier(i, { valeur: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                f.appliquer();
              }
            }}
          />
        </>
      )}
      <button type="button" className="bouton-secondaire px-2" aria-label={`Retirer la condition ${rang} sur ${def.libelle}`} onClick={() => f.retirer(i)}>
        ×
      </button>
      {incomplete && (
        <span id={`${id}-aide`} className="w-full text-xs text-erreur">
          {def.type === "nombre" ? "Saisissez un nombre." : "Saisissez des chiffres."}
        </span>
      )}
    </div>
  );
}

/** Menu « Colonnes » : afficher, masquer, déplacer, et filtrer chaque colonne (y compris masquée). */
function MenuColonnes({
  colonnes,
  dispo,
  changer,
  f,
  parDefaut,
}: {
  colonnes: Map<string, DefColonne>;
  dispo: Disposition;
  changer: (d: Disposition) => void;
  f: FiltreAdresse;
  parDefaut: () => void;
}) {
  const derniere = dispo.filter((d) => d.visible).length === 1;
  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-xs text-doux">Cochez les colonnes à afficher ; les flèches changent leur ordre.</p>
      <ul className="flex flex-col divide-y divide-bordure">
        {dispo.map((d, k) => {
          const def = colonnes.get(d.id);
          if (!def) return null;
          const n = f.filtre.conditions.filter((c) => c.colonne === d.id && f.complete(c)).length;
          return (
            <li key={d.id} className="py-1.5">
              <div className="flex items-center gap-1">
                <label className="flex flex-1 items-center gap-2">
                  <input type="checkbox" checked={d.visible} disabled={d.visible && derniere} onChange={() => changer(basculer(dispo, d.id))} />
                  {def.libelle}
                </label>
                <button
                  type="button"
                  className="rounded px-1.5 hover:bg-accent-doux disabled:opacity-30"
                  disabled={k === 0}
                  aria-label={`Monter « ${def.libelle} »`}
                  onClick={() => changer(deplacer(dispo, d.id, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 hover:bg-accent-doux disabled:opacity-30"
                  disabled={k === dispo.length - 1}
                  aria-label={`Descendre « ${def.libelle} »`}
                  onClick={() => changer(deplacer(dispo, d.id, 1))}
                >
                  ↓
                </button>
              </div>
              {def.filtrable !== false && (
                <details className="mt-1 pl-6" open={n > 0 || undefined}>
                  <summary className="cursor-pointer text-xs text-doux">Filtrer{n ? ` (${n})` : ""}</summary>
                  <div className="mt-1.5">
                    <ConditionsColonne def={def} f={f} />
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="lien mt-1 self-start text-sm" onClick={parDefaut}>
        Revenir à la disposition par défaut
      </button>
    </div>
  );
}
