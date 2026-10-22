"use client";

import { useState, useTransition } from "react";
import type { Fratrie as RegleFratrie, LigneCarnet, LigneGrille, Periodicite, Public } from "@/db/tarifs";
import { libelleCombinaison } from "@/domaine/tarif/calculer";
import { formaterEuros, lireEuros } from "@/lib/montant";
import { carnet, prixCase, regleFratrie, retirerCarnet } from "../actions";

const PUBLICS: [Public, string][] = [
  ["enfant", "Enfant"],
  ["adulte", "Adulte"],
  ["couple", "Couple"],
  ["etudiant", "Étudiant"],
];
const PERIODICITES: [Periodicite, string][] = [
  ["trimestre", "Trimestre"],
  ["annee", "Année"],
  ["unite", "À l’unité"],
];
const DUREES = [30, 45, 60, 75, 90, 120];

/** Centimes → saisie en euros (« 110 », « 112,50 »), sans nombre à virgule. */
const enEuros = (c: number) => `${Math.trunc(c / 100)}${c % 100 ? `,${String(c % 100).padStart(2, "0")}` : ""}`;

type Etat = "enregistre" | "erreur" | null;

/** Prix d'une case, enregistré en quittant le champ (Entrée ou Tab) ; vide = pas de forfait. */
function CellulePrix({
  saisonId,
  ligne,
  periodicite,
  libelle,
}: {
  saisonId: string;
  ligne: Pick<LigneGrille, "public" | "combinaison" | "disciplineId" | "prix">;
  periodicite: Periodicite;
  libelle: string;
}) {
  const actuel = ligne.prix[periodicite];
  const initial = actuel ? enEuros(actuel.centimes) : "";
  const [valeur, setValeur] = useState(initial);
  const [etat, setEtat] = useState<Etat>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const enregistrer = () => {
    if (valeur.trim() === initial) return;
    const centimes = valeur.trim() === "" ? null : lireEuros(valeur);
    if (valeur.trim() !== "" && centimes === null) {
      setEtat("erreur");
      setMessage("Montant en euros, par exemple 110 ou 112,50");
      return;
    }
    demarrer(async () => {
      const r = await prixCase(saisonId, {
        public: ligne.public,
        combinaison: ligne.combinaison,
        disciplineId: ligne.disciplineId,
        periodicite,
        prixCentimes: centimes,
      });
      setEtat(r.message ? "erreur" : "enregistre");
      setMessage(r.message);
      if (r.message) setValeur(initial);
    });
  };

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1">
        <input
          aria-label={libelle}
          inputMode="decimal"
          className={`champ w-24 text-right tabular-nums ${etat === "erreur" ? "border-erreur" : ""}`}
          value={valeur}
          placeholder="—"
          disabled={enCours}
          onChange={(e) => {
            setValeur(e.target.value);
            setEtat(null);
          }}
          onBlur={enregistrer}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
        />
        <span className="w-3 text-xs" aria-hidden>
          {etat === "enregistre" ? "✓" : "€"}
        </span>
      </div>
      {actuel?.utilise && <span className="text-[11px] text-doux">déjà utilisé</span>}
      {message && (
        <span role="alert" className="max-w-40 text-right text-[11px] text-erreur">
          {message}
        </span>
      )}
    </div>
  );
}

export function Grille({
  saisonId,
  grille,
  disciplines,
}: {
  saisonId: string;
  grille: LigneGrille[];
  disciplines: { id: string; nom: string }[];
}) {
  const [publicChoisi, setPublic] = useState<Public>("enfant");
  const [combinaison, setCombinaison] = useState<number[]>([]);
  const [disciplineId, setDisciplineId] = useState("");
  const [duree, setDuree] = useState("60");
  const [nouveauxPrix, setNouveauxPrix] = useState<Record<Periodicite, string>>({
    trimestre: "",
    annee: "",
    unite: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const lignes = grille.filter((l) => l.public === publicChoisi);

  const ajouterLigne = () =>
    demarrer(async () => {
      const prix = PERIODICITES.flatMap(([p]) =>
        nouveauxPrix[p].trim() ? [[p, lireEuros(nouveauxPrix[p])] as const] : [],
      );
      if (prix.length === 0) return setMessage("Indiquez au moins un prix.");
      if (prix.some(([, c]) => c === null)) return setMessage("Montant en euros, par exemple 110 ou 112,50.");
      for (const [periodicite, centimes] of prix) {
        const r = await prixCase(saisonId, {
          public: publicChoisi,
          combinaison,
          disciplineId: disciplineId || null,
          periodicite,
          prixCentimes: centimes,
        });
        if (r.message) return setMessage(r.message);
      }
      setMessage(null);
      setCombinaison([]);
      setNouveauxPrix({ trimestre: "", annee: "", unite: "" });
    });

  const retirerLigne = (l: LigneGrille) =>
    demarrer(async () => {
      for (const [periodicite] of PERIODICITES) {
        if (!l.prix[periodicite]) continue;
        const r = await prixCase(saisonId, {
          public: l.public,
          combinaison: l.combinaison,
          disciplineId: l.disciplineId,
          periodicite,
          prixCentimes: null,
        });
        if (r.message) return setMessage(r.message);
      }
      setMessage(null);
    });

  return (
    <section aria-labelledby="grille" className="flex flex-col gap-3">
      <h2 id="grille" className="text-base font-semibold">
        Grille des forfaits
      </h2>
      <div role="tablist" aria-label="Public" className="flex flex-wrap gap-1">
        {PUBLICS.map(([p, libelle]) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={publicChoisi === p}
            className="rounded-md border border-bordure px-3 py-1.5 text-sm aria-selected:border-accent aria-selected:bg-accent-doux aria-selected:font-medium"
            onClick={() => setPublic(p)}
          >
            {libelle} <span className="text-doux">({grille.filter((l) => l.public === p).length})</span>
          </button>
        ))}
      </div>

      <div className="panneau overflow-x-auto">
        <table className="tableau">
          <thead>
            <tr>
              <th>Cours de la semaine</th>
              {PERIODICITES.map(([p, libelle]) => (
                <th key={p} className="text-right">
                  {libelle}
                </th>
              ))}
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 && (
              <tr>
                <td colSpan={5} className="text-doux">
                  Aucun forfait pour ce public : ajoutez une ligne ci-dessous.
                </td>
              </tr>
            )}
            {lignes.map((l) => {
              const cle = `${l.combinaison.join("+")}|${l.disciplineId ?? ""}`;
              const libelle = libelleCombinaison(l.combinaison);
              const utilisee = PERIODICITES.some(([p]) => l.prix[p]?.utilise);
              return (
                <tr key={cle}>
                  <td>
                    <span className="font-medium">{libelle}</span>
                    {l.discipline && (
                      <span className="ml-2 rounded bg-accent-doux px-1.5 text-xs">{l.discipline} seulement</span>
                    )}
                  </td>
                  {PERIODICITES.map(([p, libellePeriode]) => (
                    <td key={`${cle}-${p}-${l.prix[p]?.centimes ?? "vide"}`}>
                      <CellulePrix
                        saisonId={saisonId}
                        ligne={l}
                        periodicite={p}
                        libelle={`${libelle}, ${libellePeriode}`}
                      />
                    </td>
                  ))}
                  <td className="text-right">
                    {!utilisee && (
                      <button
                        type="button"
                        className="lien text-xs text-doux"
                        disabled={enCours}
                        onClick={() => retirerLigne(l)}
                        aria-label={`Retirer la ligne ${libelle}`}
                      >
                        Retirer
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panneau flex flex-col gap-3 p-4 text-sm">
        <p className="font-semibold">Nouvelle ligne ({PUBLICS.find(([p]) => p === publicChoisi)?.[1].toLowerCase()})</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="duree">Cours de</label>
            <select id="duree" className="champ" value={duree} onChange={(e) => setDuree(e.target.value)}>
              {DUREES.map((d) => (
                <option key={d} value={d}>
                  {libelleCombinaison([d])}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="bouton-secondaire"
            onClick={() => setCombinaison([...combinaison, Number(duree)].sort((a, b) => a - b))}
          >
            Ajouter ce cours
          </button>
          <span className="pb-2" aria-live="polite">
            {combinaison.length === 0 ? (
              <span className="text-doux">Aucun cours choisi.</span>
            ) : (
              <>
                <span className="font-medium">{libelleCombinaison(combinaison)}</span>{" "}
                <button type="button" className="lien text-xs" onClick={() => setCombinaison([])}>
                  Effacer
                </button>
              </>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="discipline-ligne">Discipline</label>
            <select
              id="discipline-ligne"
              className="champ"
              value={disciplineId}
              onChange={(e) => setDisciplineId(e.target.value)}
            >
              <option value="">Toutes</option>
              {disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom} seulement
                </option>
              ))}
            </select>
          </div>
          {PERIODICITES.map(([p, libelle]) => (
            <div key={p} className="flex flex-col gap-1">
              <label htmlFor={`prix-${p}`}>{libelle} (€)</label>
              <input
                id={`prix-${p}`}
                inputMode="decimal"
                className="champ w-28 text-right"
                value={nouveauxPrix[p]}
                onChange={(e) => setNouveauxPrix({ ...nouveauxPrix, [p]: e.target.value })}
              />
            </div>
          ))}
          <button
            type="button"
            className="bouton-principal"
            disabled={enCours || combinaison.length === 0}
            onClick={ajouterLigne}
          >
            Ajouter la ligne
          </button>
        </div>
        {message && (
          <p role="alert" className="text-erreur">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

export function Fratrie({ saisonId, fratrie }: { saisonId: string; fratrie: RegleFratrie | null }) {
  const [v, setV] = useState({
    active: fratrie !== null,
    mode: fratrie?.montantCentimes ? "montant" : "taux",
    valeur: fratrie?.montantCentimes
      ? enEuros(fratrie.montantCentimes)
      : fratrie?.tauxPointsBase
        ? enEuros(fratrie.tauxPointsBase)
        : "10",
    seuil: String(fratrie?.seuilDanseurs ?? 2),
    publics: fratrie?.publics ?? (["enfant"] as Public[]),
    cumulable: fratrie?.cumulableMultiDisciplines ?? false,
  });
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [enCours, demarrer] = useTransition();

  const enregistrer = () =>
    demarrer(async () => {
      // Pourcentage saisi « 10 » ou « 12,5 » : en points de base (1000 = 10 %), sans nombre à virgule.
      const nombre = lireEuros(v.valeur);
      if (v.active && nombre === null) return setMessage({ texte: "Valeur invalide.", erreur: true });
      const r = await regleFratrie(
        saisonId,
        v.active
          ? {
              tauxPointsBase: v.mode === "taux" ? nombre : null,
              montantCentimes: v.mode === "montant" ? nombre : null,
              seuilDanseurs: Number(v.seuil),
              publics: v.publics,
              cumulableMultiDisciplines: v.cumulable,
            }
          : null,
      );
      setMessage(r.message ? { texte: r.message, erreur: true } : { texte: "Réduction enregistrée.", erreur: false });
    });

  return (
    <section aria-labelledby="fratrie" className="panneau flex flex-col gap-3 p-4 text-sm">
      <h2 id="fratrie" className="text-base font-semibold">
        Réduction fratrie
      </h2>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
        Accorder une réduction aux élèves d’un même payeur
      </label>
      {v.active && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="fratrie-valeur">Réduction</label>
              <input
                id="fratrie-valeur"
                inputMode="decimal"
                className="champ w-24 text-right"
                value={v.valeur}
                onChange={(e) => setV({ ...v, valeur: e.target.value })}
              />
            </div>
            <label className="sr-only" htmlFor="fratrie-mode">
              Unité
            </label>
            <select
              id="fratrie-mode"
              className="champ"
              value={v.mode}
              onChange={(e) => setV({ ...v, mode: e.target.value })}
            >
              <option value="taux">% par élève</option>
              <option value="montant">€ par élève</option>
            </select>
            <div className="flex flex-col gap-1">
              <label htmlFor="fratrie-seuil">À partir de</label>
              <select
                id="fratrie-seuil"
                className="champ"
                value={v.seuil}
                onChange={(e) => setV({ ...v, seuil: e.target.value })}
              >
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} élèves
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1">Pour les publics</legend>
            {PUBLICS.map(([p, libelle]) => (
              <label key={p} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.publics.includes(p)}
                  onChange={(e) =>
                    setV({ ...v, publics: e.target.checked ? [...v.publics, p] : v.publics.filter((x) => x !== p) })
                  }
                />
                {libelle}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v.cumulable}
              onChange={(e) => setV({ ...v, cumulable: e.target.checked })}
            />
            Cumulable avec un forfait de plusieurs disciplines
          </label>
        </>
      )}
      <button type="button" className="bouton-principal self-start" disabled={enCours} onClick={enregistrer}>
        Enregistrer
      </button>
      {message && (
        <p role={message.erreur ? "alert" : "status"} className={message.erreur ? "text-erreur" : ""}>
          {message.texte}
        </p>
      )}
    </section>
  );
}

export function Carnets({ saisonId, carnets }: { saisonId: string; carnets: LigneCarnet[] }) {
  const [v, setV] = useState({ nbSeances: "5", personnesMax: "1", prix: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const agir = (action: () => Promise<{ message: string | null }>, apres?: () => void) =>
    demarrer(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) apres?.();
    });

  return (
    <section aria-labelledby="carnets" className="panneau flex flex-col gap-3 p-4 text-sm">
      <h2 id="carnets" className="text-base font-semibold">
        Carnets de cours particuliers
      </h2>
      {carnets.length === 0 ? (
        <p className="text-doux">Aucun carnet pour cette saison.</p>
      ) : (
        <ul className="divide-y divide-bordure rounded-md border border-bordure">
          {carnets.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
              <span className="font-medium">
                {c.nbSeances} séance{c.nbSeances > 1 ? "s" : ""}
              </span>
              <span className="text-doux">
                {c.personnesMax === 1 ? "1 personne" : `jusqu’à ${c.personnesMax} personnes`}
              </span>
              <span className="tabular-nums">{formaterEuros(c.prixCentimes)}</span>
              <button
                type="button"
                className="lien ml-auto text-xs text-doux"
                disabled={enCours}
                onClick={() => agir(() => retirerCarnet(c.id))}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const prix = lireEuros(v.prix);
          if (prix === null) return setMessage("Montant en euros, par exemple 250.");
          agir(
            () =>
              carnet(saisonId, {
                nbSeances: Number(v.nbSeances),
                personnesMax: Number(v.personnesMax),
                prixCentimes: prix,
              }),
            () => setV({ ...v, prix: "" }),
          );
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="carnet-seances">Séances</label>
          <input
            id="carnet-seances"
            type="number"
            min={1}
            className="champ w-20"
            value={v.nbSeances}
            onChange={(e) => setV({ ...v, nbSeances: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="carnet-personnes">Personnes (max)</label>
          <input
            id="carnet-personnes"
            type="number"
            min={1}
            className="champ w-20"
            value={v.personnesMax}
            onChange={(e) => setV({ ...v, personnesMax: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="carnet-prix">Prix (€)</label>
          <input
            id="carnet-prix"
            inputMode="decimal"
            className="champ w-28 text-right"
            value={v.prix}
            onChange={(e) => setV({ ...v, prix: e.target.value })}
          />
        </div>
        <button type="submit" className="bouton-secondaire" disabled={enCours}>
          Enregistrer le carnet
        </button>
      </form>
      <p className="text-xs text-doux">Même nombre de séances et de personnes : le prix est mis à jour.</p>
      {message && (
        <p role="alert" className="text-erreur">
          {message}
        </p>
      )}
    </section>
  );
}
