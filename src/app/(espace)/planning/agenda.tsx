"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { aimanter, disposer, versHeure, versMinutes } from "@/domaine/planning/agenda";
import { type Horaire, plagesOuvertes } from "@/domaine/planning/horaires";
import { fin } from "./format";

/** Hauteur d'une minute à l'écran (px) : une heure fait 64 px. */
const PX = 64 / 60;
/** Mouvement en dessous duquel un appui reste un clic. */
const SEUIL = 4;

export type Creneau = { jourSemaine: number; heureDebut: string; dureeMinutes: number };

/** Bloc de l'agenda : un cours de la semaine type ou une séance datée. */
export type ElementAgenda = Creneau & {
  id: string;
  titre: string;
  /** Lignes de détail (salle et intervenant, effectif…). */
  lignes: string[];
  /** Petite étiquette (« 1 sem. sur 2 », « déplacée »). */
  etiquette?: string | null;
  /** Mention en couleur d'alerte (« complet », « annulée »). */
  alerte?: string | null;
  /** Bloc barré et grisé (séance annulée). */
  barre?: boolean;
  href: string;
  deplacable: boolean;
};

/** Colonne d'un jour ; `ferme` : libellé d'une fermeture qui couvre tout le jour. */
export type ColonneAgenda = { jour: number; titre: string; ferme?: string | null };

/** Réponse à un déplacement : fait, refusé, ou un choix à proposer (« cette séance seulement »…). */
export type RetourAgenda =
  | { statut: "ok"; texte: string; alertes: string[] }
  | { statut: "choisir"; question: string; choix: { valeur: string; libelle: string }[] }
  | { statut: "refus"; message: string };
type Geste =
  | { type: "deplacer" | "etirer"; id: string; x: number; y: number; depart: Creneau; bouge: boolean }
  | { type: "creer"; jour: number; y: number; ancre: number; bouge: boolean };
/** Créneau atteint par le geste en cours. */
type Cible = { apercu?: { id: string } & Creneau; selection?: { jour: number; debut: number; duree: number } };

type Props = {
  elements: ElementAgenda[];
  colonnes: ColonneAgenda[];
  /** Plage affichée, en minutes depuis minuit. */
  debut: number;
  fin: number;
  /** Horaires d'ouverture des sites affichés (#90) : tranches fermées hachurées ; vide : rien. */
  horaires: Horaire[];
  modifiable: boolean;
  misEnAvant?: string;
  /** Déplace un élément ; `choix` : réponse à une question posée par un retour « choisir ». */
  deplacer: (id: string, creneau: Creneau, choix: string | null) => Promise<RetourAgenda>;
  /** Créneau libre choisi (clic ou glissé) : créer un cours. */
  creer: (jour: number, debut: number, duree: number) => void;
};

/**
 * Agenda en colonnes (jours), sur un axe horaire commun : semaine type des
 * cours ou semaine datée des séances (#79, #90). Direction : glisser un bloc
 * le déplace (jour et heure, au quart d'heure), tirer son bord bas change sa
 * durée, glisser sur un créneau vide crée un cours ; un clic ou un appui sur
 * un créneau vide propose un cours d'une heure. Au clavier, chaque bloc ouvre
 * sa fiche.
 */
export function Agenda({
  elements,
  colonnes: jours,
  debut: ouverture,
  fin: fermeture,
  horaires,
  modifiable,
  misEnAvant,
  deplacer,
  creer,
}: Props) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  /** Créneau affiché pendant un geste, puis jusqu'au rechargement des données. */
  const [apercu, setApercu] = useState<({ id: string } & Creneau) | null>(null);
  const [selection, setSelection] = useState<{ jour: number; debut: number; duree: number } | null>(null);
  const [aConfirmer, setAConfirmer] = useState<{
    id: string;
    creneau: Creneau;
    question: string;
    choix: { valeur: string; libelle: string }[];
  } | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "refus"; texte: string; alertes: string[] } | null>(null);
  const colonnes = useRef(new Map<number, HTMLDivElement>());
  const vientDeGlisser = useRef(false);

  /** Tranches fermées d'un jour (grisées), quand des horaires sont connus. */
  const fermees = (jour: number) => {
    if (horaires.length === 0) return [];
    const r: { debut: number; fin: number }[] = [];
    let curseur = ouverture;
    for (const p of plagesOuvertes(horaires, jour)) {
      if (p.debut > curseur) r.push({ debut: curseur, fin: Math.min(p.debut, fermeture) });
      curseur = Math.max(curseur, p.fin);
    }
    if (curseur < fermeture) r.push({ debut: curseur, fin: fermeture });
    return r;
  };
  const affiches = elements.map((c) => (apercu?.id === c.id ? { ...c, ...apercu } : c));
  const places = disposer(affiches);
  const hauteur = (fermeture - ouverture) * PX;
  const heures = Array.from({ length: (fermeture - ouverture) / 60 + 1 }, (_, i) => ouverture + i * 60);

  const minuteA = (clientY: number, jour: number) => {
    const rect = colonnes.current.get(jour)?.getBoundingClientRect();
    return rect ? ouverture + (clientY - rect.top) / PX : ouverture;
  };
  const jourA = (clientX: number) => {
    for (const [jour, el] of colonnes.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return jour;
    }
    return null;
  };

  function envoyer(id: string, creneau: Creneau, choix: string | null) {
    setMessage(null);
    demarrer(async () => {
      let r: RetourAgenda;
      try {
        r = await deplacer(id, creneau, choix);
      } catch {
        r = { statut: "refus", message: "Le déplacement n’a pas pu être enregistré : réessayez." };
      }
      if (r.statut === "choisir") {
        setAConfirmer({ id, creneau, question: r.question, choix: r.choix });
        return;
      }
      setAConfirmer(null);
      if (r.statut === "refus") {
        setApercu(null);
        setMessage({ type: "refus", texte: r.message, alertes: [] });
        return;
      }
      setMessage({ type: "ok", texte: r.texte, alertes: r.alertes });
      router.refresh();
      setApercu(null);
    });
  }

  function annuler() {
    setAConfirmer(null);
    setApercu(null);
  }

  const nouveau = creer;

  /**
   * État vivant du geste, lu par les écouteurs de la fenêtre : des
   * évènements rapprochés arrivent avant le rendu suivant, l'état React
   * serait encore celui d'avant.
   */
  const geste = useRef<(Geste & Cible) | null>(null);
  const [actif, setActif] = useState(false);

  function commencer(g: Geste) {
    geste.current = g;
    setActif(true);
  }

  // Gestes sur un cours : déplacer (corps) ou étirer (bord bas).
  function saisirCours(e: React.PointerEvent, c: ElementAgenda, type: "deplacer" | "etirer") {
    if (!modifiable || !c.deplacable || e.button !== 0 || enCours || aConfirmer) return;
    e.stopPropagation();
    vientDeGlisser.current = false;
    commencer({
      type,
      id: c.id,
      x: e.clientX,
      y: e.clientY,
      bouge: false,
      depart: { jourSemaine: c.jourSemaine, heureDebut: c.heureDebut, dureeMinutes: c.dureeMinutes },
    });
  }

  // Glisser sur un créneau vide (souris) : choisir début et durée d'un nouveau cours.
  function saisirVide(e: React.PointerEvent, jour: number) {
    if (!modifiable || e.button !== 0 || e.pointerType !== "mouse" || enCours || aConfirmer) return;
    const ancre = Math.max(ouverture, Math.floor(minuteA(e.clientY, jour) / 15) * 15);
    commencer({ type: "creer", jour, y: e.clientY, ancre, bouge: false });
  }

  function bouger(e: PointerEvent) {
    const g = geste.current;
    if (!g) return;
    g.bouge ||= Math.abs(e.clientY - g.y) > SEUIL || (g.type !== "creer" && Math.abs(e.clientX - g.x) > SEUIL);
    if (!g.bouge) return;
    if (g.type === "creer") {
      const ici = Math.min(fermeture, Math.max(ouverture, aimanter(minuteA(e.clientY, g.jour))));
      g.selection = { jour: g.jour, debut: Math.min(g.ancre, ici), duree: Math.max(15, Math.abs(ici - g.ancre)) };
      setSelection(g.selection);
      return;
    }
    const { depart } = g;
    const decalage = aimanter((e.clientY - g.y) / PX);
    if (g.type === "etirer") {
      const debut = versMinutes(depart.heureDebut);
      g.apercu = {
        id: g.id,
        ...depart,
        dureeMinutes: Math.min(fermeture - debut, Math.max(15, depart.dureeMinutes + decalage)),
      };
    } else {
      const debut = Math.min(
        fermeture - depart.dureeMinutes,
        Math.max(ouverture, versMinutes(depart.heureDebut) + decalage),
      );
      g.apercu = {
        id: g.id,
        ...depart,
        jourSemaine: jourA(e.clientX) ?? depart.jourSemaine,
        heureDebut: versHeure(debut),
      };
    }
    setApercu(g.apercu);
  }

  function lacher() {
    const g = geste.current;
    if (!g) return;
    geste.current = null;
    setActif(false);
    if (g.type === "creer") {
      setSelection(null);
      if (g.bouge && g.selection) nouveau(g.selection.jour, g.selection.debut, g.selection.duree);
      else nouveau(g.jour, g.ancre, 60);
      return;
    }
    if (!g.bouge) return; // simple clic : le lien ouvre la fiche
    vientDeGlisser.current = true;
    const a = g.apercu;
    if (
      !a ||
      (a.jourSemaine === g.depart.jourSemaine &&
        a.heureDebut === g.depart.heureDebut &&
        a.dureeMinutes === g.depart.dureeMinutes)
    ) {
      setApercu(null);
      return;
    }
    envoyer(g.id, { jourSemaine: a.jourSemaine, heureDebut: a.heureDebut, dureeMinutes: a.dureeMinutes }, null);
  }

  function abandonner() {
    geste.current = null;
    setActif(false);
    setSelection(null);
    setApercu(null);
  }

  // Le geste se suit sur toute la fenêtre : le cours change de colonne en
  // cours de route (et perd la capture du pointeur), et on peut lâcher hors
  // de la grille. Échap abandonne.
  useEffect(() => {
    if (!actif) return;
    const touche = (e: KeyboardEvent) => e.key === "Escape" && abandonner();
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
    window.addEventListener("pointercancel", abandonner);
    window.addEventListener("keydown", touche);
    return () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      window.removeEventListener("pointercancel", abandonner);
      window.removeEventListener("keydown", touche);
    };
  });

  // Appui (tactile) sur un créneau vide : un cours d'une heure à cet endroit.
  function toucherVide(e: React.MouseEvent, jour: number) {
    if (!modifiable || enCours || aConfirmer || e.target !== e.currentTarget) return;
    if ((e.nativeEvent as PointerEvent).pointerType === "mouse") return; // géré par saisirVide
    nouveau(jour, Math.max(ouverture, Math.min(fermeture - 60, Math.floor(minuteA(e.clientY, jour) / 15) * 15)), 60);
  }

  return (
    <div className="flex flex-col gap-3">
      {aConfirmer && (
        <div
          role="alertdialog"
          aria-labelledby="confirmer-deplacement"
          className="panneau flex flex-wrap items-center gap-3 border-accent p-3 text-sm"
        >
          <p id="confirmer-deplacement" className="flex-1">
            {aConfirmer.question}
          </p>
          <div className="flex flex-wrap gap-2">
            {aConfirmer.choix.map((c, i) => (
              <button
                key={c.valeur}
                type="button"
                className={i === 0 ? "bouton-principal" : "bouton-secondaire"}
                disabled={enCours}
                onClick={() => envoyer(aConfirmer.id, aConfirmer.creneau, c.valeur)}
                autoFocus={i === 0}
              >
                {c.libelle}
              </button>
            ))}
            <button type="button" className="bouton-secondaire" disabled={enCours} onClick={annuler}>
              Annuler
            </button>
          </div>
        </div>
      )}
      <div aria-live="polite">
        {message && (
          <div
            role="status"
            className={`rounded-md border px-3 py-2 text-sm ${message.type === "ok" ? "border-accent bg-accent-doux" : "border-erreur text-erreur"}`}
          >
            <p>{message.texte}</p>
            {message.alertes.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-alerte-texte">
                {message.alertes.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {modifiable && (
        <p className="text-xs text-doux">
          Glissez un bloc pour le déplacer, tirez son bord bas pour changer sa durée, cliquez ou glissez sur un créneau
          libre pour créer un cours.
        </p>
      )}

      <div className="panneau overflow-x-auto">
        <div
          className="grid min-w-[44rem] select-none"
          style={{ gridTemplateColumns: `3rem repeat(${jours.length}, minmax(6.5rem, 1fr))` }}
        >
          <div className="sticky left-0 z-20 border-b border-bordure bg-surface" />
          {jours.map((c) => (
            <h2 key={c.jour} className="border-b border-l border-bordure px-2 py-1.5 text-sm font-semibold">
              {c.titre}
              {c.ferme && <span className="block truncate text-xs font-normal text-alerte-texte">{c.ferme}</span>}
            </h2>
          ))}

          <div className="sticky left-0 z-20 bg-surface" style={{ height: hauteur }} aria-hidden>
            {heures.map((h) => (
              <span
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-xs tabular-nums text-doux"
                style={{ top: (h - ouverture) * PX }}
              >
                {h < fermeture && h > ouverture ? `${h / 60} h` : ""}
              </span>
            ))}
          </div>
          {jours.map(({ jour: j, ferme }) => (
            <div
              key={j}
              ref={(el) => {
                if (el) colonnes.current.set(j, el);
                else colonnes.current.delete(j);
              }}
              className={`relative border-l border-bordure ${modifiable ? "cursor-cell" : ""}`}
              style={{
                height: hauteur,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--bordure) 0 1px, transparent 1px ${60 * PX}px)`,
              }}
              onPointerDown={(e) => saisirVide(e, j)}
              onClick={(e) => toucherVide(e, j)}
            >
              {ferme && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent_0_6px,var(--alerte-fond)_6px_8px)]"
                />
              )}
              {fermees(j).map((z) => (
                <div
                  key={z.debut}
                  aria-hidden
                  title="Site fermé"
                  className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(45deg,transparent_0_6px,var(--bordure)_6px_7px)] opacity-70"
                  style={{ top: (z.debut - ouverture) * PX, height: (z.fin - z.debut) * PX }}
                />
              ))}
              {selection?.jour === j && (
                <div
                  className="pointer-events-none absolute inset-x-1 z-10 rounded border-2 border-dashed border-accent bg-accent-doux/60 px-1.5 text-xs font-medium"
                  style={{ top: (selection.debut - ouverture) * PX, height: selection.duree * PX }}
                >
                  {versHeure(selection.debut)}–{versHeure(selection.debut + selection.duree)}
                </div>
              )}
              {affiches
                .filter((c) => c.jourSemaine === j)
                .map((c) => {
                  const place = places.get(c.id) ?? { colonne: 0, colonnes: 1 };
                  const debut = versMinutes(c.heureDebut);
                  const deplace = apercu?.id === c.id;
                  const largeur = 100 / place.colonnes;
                  return (
                    <div
                      key={c.id}
                      className={`absolute overflow-hidden rounded border-l-4 border-accent bg-accent-doux text-xs shadow-sm ${
                        c.id === misEnAvant ? "ring-2 ring-accent" : ""
                      } ${deplace ? "z-10 opacity-90 ring-2 ring-accent" : ""} ${c.barre ? "border-doux opacity-60" : ""} ${
                        modifiable && c.deplacable ? "cursor-grab touch-none active:cursor-grabbing" : ""
                      }`}
                      style={{
                        top: (debut - ouverture) * PX + 1,
                        height: Math.max(18, c.dureeMinutes * PX - 2),
                        left: `calc(${place.colonne * largeur}% + 2px)`,
                        width: `calc(${largeur}% - 4px)`,
                      }}
                      onPointerDown={(e) => saisirCours(e, c, "deplacer")}
                    >
                      <Link
                        href={c.href}
                        draggable={false}
                        className="block h-full px-1.5 py-0.5 leading-tight text-texte focus-visible:outline-2 focus-visible:outline-accent"
                        onClick={(e) => {
                          if (vientDeGlisser.current) {
                            e.preventDefault();
                            vientDeGlisser.current = false;
                          }
                        }}
                      >
                        <span className={`block font-semibold ${c.barre ? "line-through" : ""}`}>
                          {c.titre}
                          {c.alerte && <span className="font-normal text-alerte-texte"> · {c.alerte}</span>}
                          {c.etiquette && (
                            <span className="ml-1 rounded bg-surface px-1 font-normal text-doux">{c.etiquette}</span>
                          )}
                        </span>
                        <span className="block tabular-nums">
                          {c.heureDebut}–{fin(c.heureDebut, c.dureeMinutes)}
                        </span>
                        {c.lignes.map((l) => (
                          <span key={l} className="block truncate text-doux">
                            {l}
                          </span>
                        ))}
                      </Link>
                      {modifiable && c.deplacable && (
                        <div
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                          onPointerDown={(e) => saisirCours(e, c, "etirer")}
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
