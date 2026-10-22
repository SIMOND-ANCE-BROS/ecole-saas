"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
import { ecrireFiltreColonne, type FiltreColonne, lireFiltreColonne, resumeFiltreColonne } from "@/domaine/filtres/colonne";
import type { Liste } from "@/domaine/filtres/colonnes";
import { basculer, type Disposition, deplacer, dispositionParDefaut, ecrireDisposition, lireDisposition, placer, redimensionner } from "@/domaine/filtres/disposition";
import { type DefColonne, libelleCondition, lireTri, type Tri, VIDE } from "@/domaine/filtres/filtres";
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
  /** Affichage propre au téléphone (le tableau y est masqué). */
  mobile?: ReactNode;
  /** Valeurs à cocher fournies par la page, par colonne (cours de la saison, statuts…). */
  choix?: Record<string, readonly string[]>;
  /** Action proposée quand la liste est vide sans filtre (« Nouvel élève »). */
  actionVide?: ReactNode;
};

/** Au-delà, la liste des cases à cocher a son propre champ de recherche. */
const CASES_SANS_RECHERCHE = 8;

/**
 * Liste en tableau (#89, #107), pensée pour l'accueil et proche d'Excel :
 * chaque titre de colonne ouvre un menu pour trier et filtrer (cases à
 * cocher, « de … à … », « contient »). Le sens du tri et les colonnes filtrées
 * se voient sur les titres ; les filtres actifs sont rappelés en pastilles.
 * Toute la ligne ouvre la fiche. Le menu « Colonnes » affiche, masque et
 * réordonne (mémorisé pour le membre). Filtres et tri vont dans l'adresse ;
 * la page relit et interroge le serveur.
 */
export function TableauListe({ liste, quoi, legende, colonnes, disposition, lignes, lien, vide, mobile, choix = {}, actionVide }: Props) {
  const f = useFiltreAdresse(colonnes);
  const router = useRouter();
  const chemin = usePathname();
  const params = useSearchParams();
  const [triEnCours, demarrerTri] = useTransition();
  const tri = lireTri(params.get("sort"), params.get("order"), colonnes);
  const [dispo, setDispo] = useState<Disposition>(() => lireDisposition(colonnes, disposition));
  const [enregistrement, demarrer] = useTransition();
  const [echec, setEchec] = useState(false);
  const defs = new Map(colonnes.map((c) => [c.id, c]));
  const visibles = dispo.filter((d) => d.visible).flatMap((d) => defs.get(d.id) ?? []);
  const masquees = dispo.filter((d) => !d.visible).flatMap((d) => defs.get(d.id) ?? []);
  const largeurDe = (id: string) => dispo.find((d) => d.id === id)?.largeur ?? null;
  const style = (id: string) => {
    const l = largeurDe(id);
    return l ? { width: l, minWidth: l, maxWidth: l } : undefined;
  };
  const choixDe = (d: DefColonne) => choix[d.id] ?? d.choix;

  function fixerTri(suivant: Tri | null) {
    const p = new URLSearchParams(params.toString());
    p.delete("sort");
    p.delete("order");
    if (suivant) {
      p.set("sort", suivant.colonne);
      p.set("order", suivant.sens);
    }
    const texte = p.toString();
    demarrerTri(() => router.replace(texte ? `${chemin}?${texte}` : chemin, { scroll: false }));
  }

  /** Clic sur une ligne : ouvre la fiche, sauf sur un lien ou un bouton, ou pendant une sélection de texte. */
  function ouvrir(e: React.MouseEvent<HTMLTableRowElement>, href: string | undefined) {
    if (!href || (e.target as HTMLElement).closest("a, button, input, select") || window.getSelection()?.toString()) return;
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank");
    else router.push(href);
  }

  function changerDispo(d: Disposition) {
    setDispo(d);
    setEchec(false);
    demarrer(async () => setEchec(!(await enregistrerColonnes(liste, ecrireDisposition(d)))));
  }

  // Glisser-déposer d'un en-tête (souris) ; au clavier, les flèches du menu « Colonnes ».
  const [glissee, setGlissee] = useState<string | null>(null);
  const [survolee, setSurvolee] = useState<string | null>(null);

  // Largeur : on tire le bord droit d'un en-tête ; enregistrée au lâcher, double-clic pour l'automatique.
  // Pendant ce geste, l'en-tête (déplaçable) ne doit pas partir en glisser-déposer.
  const enRedimension = useRef(false);
  function redimensionnerA(e: React.PointerEvent<HTMLElement>, id: string) {
    e.preventDefault();
    e.stopPropagation();
    enRedimension.current = true;
    const th = e.currentTarget.parentElement as HTMLElement;
    const depart = e.clientX;
    const initiale = th.getBoundingClientRect().width;
    let courante = dispo;
    const bouger = (ev: PointerEvent) => {
      courante = redimensionner(dispo, id, initiale + ev.clientX - depart);
      setDispo(courante);
    };
    const lacher = () => {
      enRedimension.current = false;
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      if (courante !== dispo) changerDispo(courante);
    };
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
  }

  // Pastilles des filtres actifs, colonnes masquées comprises.
  const pastilles = colonnes.flatMap((d) => {
    const fc = lireFiltreColonne(f.filtre, d);
    const resume = resumeFiltreColonne(d, fc);
    const garder = (autres: FiltreColonne["autres"]) => f.changer(ecrireFiltreColonne(f.filtre, d, { autres }));
    return [
      ...(resume ? [{ cle: d.id, texte: resume, retirer: () => garder(fc.autres) }] : []),
      ...fc.autres
        .filter((c) => f.complete(c))
        .map((c, i) => ({ cle: `${d.id}-${i}`, texte: libelleCondition(c, colonnes), retirer: () => f.changer(ecrireFiltreColonne(f.filtre, d, { ...fc, autres: fc.autres.filter((x) => x !== c) })) })),
    ];
  });
  const filtre = pastilles.length > 0;
  const toutEffacer = () => f.changer({ mode: "et", conditions: [] });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
        {filtre ? (
          <>
            <ul className="flex flex-wrap gap-1.5" aria-label="Filtres actifs">
              {pastilles.map((p) => (
                <li key={p.cle} className="flex items-center gap-1 rounded-full border border-accent bg-accent-doux py-0.5 pr-1 pl-2.5">
                  {p.texte}
                  <button type="button" className="rounded-full px-1.5 hover:bg-surface" aria-label={`Retirer le filtre ${p.texte}`} onClick={p.retirer}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="lien" onClick={toutEffacer}>
              Effacer les filtres
            </button>
          </>
        ) : (
          <span className={`text-doux ${mobile ? "hidden sm:inline" : ""}`}>Cliquez sur le titre d’une colonne pour trier ou filtrer.</span>
        )}
        <span className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-doux" role="status">
            {f.enCours || triEnCours ? "Mise à jour…" : enregistrement ? "Enregistrement des colonnes…" : echec ? "Disposition non enregistrée : réessayez." : ""}
          </span>
          {/* Sur téléphone, des cartes : pas de colonnes à régler. */}
          <span className={mobile ? "hidden sm:inline" : ""}>
            <Bulle
              titre={`Colonnes de ${quoi}`}
              bouton={masquees.length ? `Colonnes (${masquees.length} de plus)` : "Colonnes"}
              classeBouton="bouton-secondaire"
              largeur="w-[22rem]"
            >
              <MenuColonnes colonnes={defs} dispo={dispo} changer={changerDispo} parDefaut={() => changerDispo(dispositionParDefaut(colonnes))} />
            </Bulle>
          </span>
        </span>
      </div>

      {mobile && <div className="sm:hidden">{mobile}</div>}
      <div className={`panneau overflow-x-auto ${mobile ? "hidden sm:block" : ""}`}>
        <table className="tableau">
          <caption className="sr-only">{legende}</caption>
          <thead>
            <tr>
              {visibles.map((d) => (
                <th
                  key={d.id}
                  scope="col"
                  aria-sort={tri?.colonne === d.id ? (tri.sens === "asc" ? "ascending" : "descending") : undefined}
                  draggable
                  onMouseDown={(e) => {
                    // Une poignée de largeur saisie : pas de glisser-déposer natif.
                    if ((e.target as HTMLElement).dataset.poignee) e.preventDefault();
                  }}
                  style={style(d.id)}
                  className={`relative select-none ${glissee === d.id ? "opacity-50" : ""} ${survolee === d.id && glissee !== d.id ? "shadow-[inset_3px_0_0_var(--accent)]" : ""}`}
                  onDragStart={(e) => {
                    if (enRedimension.current) return e.preventDefault();
                    setGlissee(d.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", d.id);
                  }}
                  onDragOver={(e) => {
                    if (!glissee) return;
                    e.preventDefault();
                    setSurvolee(d.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (glissee) changerDispo(placer(dispo, glissee, d.id));
                    setGlissee(null);
                    setSurvolee(null);
                  }}
                  onDragEnd={() => {
                    setGlissee(null);
                    setSurvolee(null);
                  }}
                >
                  <MenuTitre
                    def={d}
                    choix={choixDe(d)}
                    f={f}
                    tri={tri?.colonne === d.id ? tri.sens : null}
                    trier={(sens) => fixerTri(sens ? { colonne: d.id, sens } : null)}
                    masquer={visibles.length > 1 && !d.obligatoire ? () => changerDispo(basculer(dispo, d.id)) : null}
                  />
                  <span
                    aria-hidden
                    data-poignee="1"
                    title="Tirez pour changer la largeur, double-cliquez pour la largeur automatique"
                    className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-accent/40"
                    onPointerDown={(e) => redimensionnerA(e, d.id)}
                    onDoubleClick={() => changerDispo(redimensionner(dispo, d.id, null))}
                  />
                </th>
              ))}
              <th scope="col" className="w-8 px-1 text-right">
                <Bulle titre="Ajouter une colonne" libelleBouton="Ajouter une colonne" bouton="+" classeBouton="rounded px-2 py-0.5 text-base leading-none text-accent hover:bg-accent-doux">
                  <p className="mb-2 font-medium">Ajouter une colonne</p>
                  {masquees.length === 0 ? (
                    <p className="text-doux">Toutes les colonnes sont affichées.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {masquees.map((c) => (
                        <li key={c.id}>
                          <button type="button" className="lien" onClick={() => changerDispo(placer(basculer(dispo, c.id), c.id, null))}>
                            {c.libelle}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-doux">Pour retirer une colonne : cliquez sur son titre, puis « Masquer la colonne ».</p>
                </Bulle>
              </th>
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 ? (
              <tr>
                <td colSpan={visibles.length + 1} className="py-6 text-center">
                  <p className="text-doux">{vide}</p>
                  <div className="mt-3 flex justify-center gap-3">
                    {filtre ? (
                      <button type="button" className="bouton-secondaire" onClick={toutEffacer}>
                        Effacer les filtres
                      </button>
                    ) : (
                      actionVide
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              lignes.map((l) => (
                <tr key={l.id} className={`${l.attenue ? "text-doux" : ""} ${l.href ? "cursor-pointer" : ""}`} onClick={(e) => ouvrir(e, l.href)}>
                  {visibles.map((d) => (
                    <td key={d.id} style={style(d.id)} className={`${d.droite ? "text-right tabular-nums" : ""} ${largeurDe(d.id) ? "break-words" : ""}`}>
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
                  <td />
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
  if (def.type === "date") return t.slice(0, 10).split("-").reverse().join("/");
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
  children,
}: {
  titre: string;
  bouton: ReactNode;
  classeBouton: string;
  libelleBouton?: string;
  largeur?: string;
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
          if (e.newState !== "open") return;
          placer();
          requestAnimationFrame(() => {
            placer();
            bulle.current?.querySelector<HTMLElement>("input, button")?.focus();
          });
        }}
      >
        {children}
      </div>
    </>
  );
}

/** Libellés des deux sens de tri, selon la nature de la colonne. */
const SENS: Record<DefColonne["type"], [string, string]> = {
  texte: ["De A à Z", "De Z à A"],
  telephone: ["Croissant", "Décroissant"],
  nombre: ["Du plus petit au plus grand", "Du plus grand au plus petit"],
  date: ["Du plus ancien au plus récent", "Du plus récent au plus ancien"],
};

/**
 * Titre d'une colonne et son menu, comme un filtre automatique d'Excel :
 * trier dans un sens ou l'autre, puis filtrer selon la nature de la colonne.
 * Le titre montre le sens du tri (▲ ▼) et un entonnoir plein si la colonne
 * est filtrée ; la flèche ▾ signale qu'on peut cliquer.
 */
function MenuTitre({
  def,
  choix,
  f,
  tri,
  trier,
  masquer,
}: {
  def: DefColonne;
  choix: readonly string[] | undefined;
  f: FiltreAdresse;
  tri: "asc" | "desc" | null;
  trier: (sens: "asc" | "desc" | null) => void;
  masquer: (() => void) | null;
}) {
  const fc = lireFiltreColonne(f.filtre, def);
  const filtree = resumeFiltreColonne(def, fc) !== null || fc.autres.length > 0;
  const triable = def.triable !== false;
  const filtrable = def.filtrable !== false;
  const changer = (maj: Partial<FiltreColonne>, differe = false) => f.changer(ecrireFiltreColonne(f.filtre, def, { ...fc, ...maj }), differe);
  const etat = [tri === "asc" ? "trié, sens croissant" : tri === "desc" ? "trié, sens décroissant" : "", filtree ? "filtré" : ""].filter(Boolean).join(", ");

  return (
    <Bulle
      titre={`Trier ou filtrer « ${def.libelle} »`}
      libelleBouton={`${def.libelle} : trier ou filtrer${etat ? ` (${etat})` : ""}`}
      classeBouton={`-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-accent-doux ${def.droite ? "justify-end" : ""} ${tri || filtree ? "text-accent" : ""}`}
      largeur="w-72"
      bouton={
        <>
          <span className="truncate">{def.libelle}</span>
          {tri && (
            <span aria-hidden className="text-xs">
              {tri === "asc" ? "▲" : "▼"}
            </span>
          )}
          {filtree && (
            <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor">
              <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" />
            </svg>
          )}
          <span aria-hidden className="text-xs text-doux">
            ▾
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {triable && (
          <div role="group" aria-label="Trier" className="flex flex-col gap-1">
            {(["asc", "desc"] as const).map((sens, i) => (
              <button
                key={sens}
                type="button"
                aria-pressed={tri === sens}
                className={`flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent-doux ${tri === sens ? "bg-accent-doux font-medium text-accent" : ""}`}
                onClick={() => trier(tri === sens ? null : sens)}
              >
                <span aria-hidden className="w-3 text-xs">
                  {sens === "asc" ? "▲" : "▼"}
                </span>
                {SENS[def.type][i]}
              </button>
            ))}
          </div>
        )}
        {filtrable && (
          <div className={`flex flex-col gap-2 ${triable ? "border-t border-bordure pt-3" : ""}`}>
            <p className="font-medium">Filtrer</p>
            <FiltreDuTitre def={def} choix={choix} fc={fc} changer={changer} />
            {fc.autres.length > 0 && <p className="text-xs text-doux">Aussi : {fc.autres.map((c) => libelleCondition(c, [def])).join(", ")}</p>}
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 border-t border-bordure pt-2 text-xs">
          {filtree ? (
            <button type="button" className="lien" onClick={() => f.changer(ecrireFiltreColonne(f.filtre, def, {}))}>
              Effacer ce filtre
            </button>
          ) : (
            <span />
          )}
          {masquer && (
            <button type="button" className="lien text-doux" onClick={masquer}>
              Masquer la colonne
            </button>
          )}
        </div>
      </div>
    </Bulle>
  );
}

/** Le filtre d'une colonne selon sa nature : cases à cocher, bornes, ou texte contenu. */
function FiltreDuTitre({
  def,
  choix,
  fc,
  changer,
}: {
  def: DefColonne;
  choix: readonly string[] | undefined;
  fc: FiltreColonne;
  changer: (maj: Partial<FiltreColonne>, differe?: boolean) => void;
}) {
  const id = useId();
  const [recherche, setRecherche] = useState("");

  if (def.type === "texte" && choix) {
    const cochees = fc.choix ?? [];
    const basculerChoix = (v: string) => changer({ choix: cochees.includes(v) ? cochees.filter((x) => x !== v) : [...cochees, v] });
    const libelle = (v: string) => (v === VIDE ? `(${def.siVide ?? "vide"})` : v);
    // « (aucune) » seulement pour une colonne qui peut être vide (`siVide`).
    const toutes = def.siVide ? [...choix, VIDE] : [...choix];
    const visibles = recherche ? toutes.filter((v) => libelle(v).toLowerCase().includes(recherche.toLowerCase())) : toutes;
    return (
      <>
        {choix.length > CASES_SANS_RECHERCHE && (
          <input type="search" className="champ" placeholder="Chercher…" aria-label={`Chercher dans « ${def.libelle} »`} value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        )}
        <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
          {visibles.map((v) => (
            <li key={v}>
              <label className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent-doux">
                <input type="checkbox" checked={cochees.includes(v)} onChange={() => basculerChoix(v)} />
                <span className={v === VIDE ? "text-doux" : ""}>{libelle(v)}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-xs text-doux">{cochees.length ? "Seules les valeurs cochées restent affichées." : "Cochez les valeurs à garder."}</p>
      </>
    );
  }

  if (def.type === "nombre" || def.type === "date") {
    const date = def.type === "date";
    return (
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-min`}>{date ? "Du" : "De"}</label>
        <input
          id={`${id}-min`}
          className="champ w-full min-w-0"
          type={date ? "date" : "text"}
          inputMode={date ? undefined : "numeric"}
          value={fc.min}
          onChange={(e) => changer({ min: e.target.value }, true)}
        />
        <label htmlFor={`${id}-max`}>{date ? "au" : "à"}</label>
        <input
          id={`${id}-max`}
          className="champ w-full min-w-0"
          type={date ? "date" : "text"}
          inputMode={date ? undefined : "numeric"}
          value={fc.max}
          onChange={(e) => changer({ max: e.target.value }, true)}
        />
      </div>
    );
  }

  return (
    <>
      <label htmlFor={`${id}-texte`} className="sr-only">
        {def.libelle} contient
      </label>
      <input
        id={`${id}-texte`}
        type="search"
        className="champ"
        placeholder="Contient…"
        inputMode={def.type === "telephone" ? "tel" : undefined}
        value={fc.texte}
        onChange={(e) => changer({ texte: e.target.value }, true)}
      />
    </>
  );
}

/** Menu « Colonnes » : afficher, masquer et déplacer les colonnes. */
function MenuColonnes({
  colonnes,
  dispo,
  changer,
  parDefaut,
}: {
  colonnes: Map<string, DefColonne>;
  dispo: Disposition;
  changer: (d: Disposition) => void;
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
          return (
            <li key={d.id} className="flex items-center gap-1 py-1.5">
              <label className="flex flex-1 items-center gap-2">
                <input type="checkbox" checked={d.visible} disabled={(d.visible && derniere) || def.obligatoire} onChange={() => changer(basculer(dispo, d.id))} />
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
