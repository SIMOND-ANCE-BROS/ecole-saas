"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Apercu } from "@/db/inscriptions";
import type { CoursPlanning } from "@/db/planning";
import { seChevauchent } from "@/domaine/planning/chevauchement";
import { formaterEuros } from "@/lib/montant";
import { requeteDifferee } from "@/lib/requete-differee";
import { apercu, inscrire, type SaisieFormulaire } from "./actions";

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const PUBLICS = [
  ["enfant", "Enfant"],
  ["adulte", "Adulte"],
  ["couple", "Couple"],
  ["etudiant", "Étudiant"],
] as const;
const PERIODICITES = [
  ["trimestre", "Trimestre"],
  ["annee", "Année"],
] as const;

type Props = {
  payeurId: string;
  danseurs: { id: string; prenom: string; age: number | null }[];
  cours: CoursPlanning[];
  /** Danseur choisi d'avance (bouton « Inscrire » de sa fiche). */
  danseurInitial?: string;
};

export function FormulaireInscription({ payeurId, danseurs, cours, danseurInitial }: Props) {
  const initial = danseurs.find((d) => d.id === danseurInitial) ?? (danseurs.length === 1 ? danseurs[0] : undefined);
  const [danseurIds, setDanseurIds] = useState<string[]>(initial ? [initial.id] : []);
  const [publicChoisi, setPublic] = useState<SaisieFormulaire["public"]>(
    initial && initial.age !== null && initial.age >= 18 ? "adulte" : "enfant",
  );
  const [periodicite, setPeriodicite] = useState<SaisieFormulaire["periodicite"]>("trimestre");
  const [coursIds, setCoursIds] = useState<string[]>([]);
  const [filtre, setFiltre] = useState("");
  const [dernierApercu, setApercu] = useState<{ saisie: SaisieFormulaire; essai: number; resultat: Apercu | null; erreur: boolean } | null>(null);
  const [essaiCalcul, setEssaiCalcul] = useState(0);
  const [refus, setRefus] = useState<string | null>(null);
  const [envoi, demarrerEnvoi] = useTransition();

  const saisie: SaisieFormulaire = useMemo(
    () => ({ payeurId, danseurIds, public: publicChoisi, periodicite, coursIds }),
    [payeurId, danseurIds, publicChoisi, periodicite, coursIds],
  );

  // Aucun prix d’une sélection précédente n’est présenté comme le prix courant.
  useEffect(() => {
    if (saisie.danseurIds.length === 0 || saisie.coursIds.length === 0) return;
    return requeteDifferee(
      () => apercu(saisie),
      (resultat) => setApercu({ saisie, essai: essaiCalcul, resultat, erreur: false }),
      () => setApercu({ saisie, essai: essaiCalcul, resultat: null, erreur: true }),
    );
  }, [saisie, essaiCalcul]);
  const courant = dernierApercu?.saisie === saisie && dernierApercu.essai === essaiCalcul ? dernierApercu : null;
  const calcul = danseurIds.length > 0 && coursIds.length > 0 && courant === null;
  const resultat = courant?.resultat ?? null;

  const basculer = (liste: string[], id: string) => (liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]);
  const coursVisibles = cours.filter((c) =>
    `${c.discipline} ${c.niveau ?? ""} ${JOURS[c.jourSemaine ?? 0]}`.toLowerCase().includes(filtre.trim().toLowerCase()),
  );
  const nouvelle = resultat?.statut === "ok" ? resultat.nouvelle : null;
  const peutEnregistrer = nouvelle?.statut === "ok" && !calcul && !envoi;

  // Cours adaptés à l'âge du ou des danseurs choisis d'abord ; les autres restent sélectionnables.
  const agesChoisis = danseurs.filter((d) => danseurIds.includes(d.id) && d.age !== null).map((d) => d.age as number);
  const adapte = (c: CoursPlanning) =>
    agesChoisis.length === 0 || agesChoisis.every((a) => (c.ageMin === null || a >= c.ageMin) && (c.ageMax === null || a <= c.ageMax));
  const coursTries = [...coursVisibles.filter(adapte), ...coursVisibles.filter((c) => !adapte(c))];

  // Cours choisis qui se chevauchent le même jour.
  const choisis = cours.filter((c) => coursIds.includes(c.id));
  const chevauchements = choisis.flatMap((a, i) =>
    choisis
      .slice(i + 1)
      .filter((b) => seChevauchent(a, b))
      .map((b) => `${a.discipline} et ${b.discipline} le ${JOURS[a.jourSemaine ?? 0].toLowerCase()}`),
  );

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1fr_22rem]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!peutEnregistrer) return;
        setRefus(null);
        demarrerEnvoi(async () => setRefus((await inscrire(saisie)).message));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && peutEnregistrer) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
    >
      <nav aria-label="Repères de saisie" className="lg:col-span-2">
        <ol className="grid grid-cols-3 gap-2 text-sm">
          {[
            { cible: "choix-danseur", titre: "Danseur & formule", complet: danseurIds.length > 0 },
            { cible: "choix-cours", titre: "Cours", complet: coursIds.length > 0 },
            { cible: "prix-inscription", titre: "Vérification du prix", complet: peutEnregistrer },
          ].map((etape, index) => (
            <li key={etape.cible}>
              <a href={`#${etape.cible}`} className={`flex h-full items-center gap-2 rounded-md border px-3 py-2 ${etape.complet ? "border-accent bg-accent-doux" : "border-bordure bg-surface text-doux"}`}>
                <span aria-hidden className="font-semibold">{index + 1}</span>
                <span>{etape.titre}</span>
                {etape.complet && <span className="sr-only"> : renseigné</span>}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">Choix de l’inscription</legend>
        <fieldset id="choix-danseur" className="panneau flex flex-col gap-2 p-3">
          <legend className="text-sm font-semibold">Danseur{publicChoisi === "couple" ? "s (deux)" : ""}</legend>
          {danseurs.map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-sm">
              <input
                type={publicChoisi === "couple" ? "checkbox" : "radio"}
                name="danseur"
                checked={danseurIds.includes(d.id)}
                onChange={() => setDanseurIds(publicChoisi === "couple" ? basculer(danseurIds, d.id) : [d.id])}
              />
              {d.prenom}
              {d.age !== null && <span className="text-doux">({d.age} ans)</span>}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="public" className="text-sm font-semibold">Public</label>
            <select
              id="public"
              className="champ"
              value={publicChoisi}
              onChange={(e) => {
                const valeur = e.target.value as SaisieFormulaire["public"];
                setPublic(valeur);
                if (valeur !== "couple") setDanseurIds(danseurIds.slice(0, 1));
              }}
            >
              {PUBLICS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="periodicite" className="text-sm font-semibold">Périodicité</label>
            <select
              id="periodicite"
              className="champ"
              value={periodicite}
              onChange={(e) => setPeriodicite(e.target.value as SaisieFormulaire["periodicite"])}
            >
              {PERIODICITES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        <fieldset id="choix-cours" className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">Cours ({coursIds.length} choisi{coursIds.length > 1 ? "s" : ""})</legend>
          <label className="sr-only" htmlFor="filtre-cours">Filtrer les cours</label>
          <input
            id="filtre-cours"
            type="search"
            className="champ max-w-xs"
            placeholder="Filtrer : jazz, mercredi, adultes…"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
          />
          <ul className="panneau flex max-h-96 flex-col overflow-y-auto">
            {coursTries.length === 0 && <li className="flex flex-col items-start gap-2 p-3 text-doux"><p>{cours.length === 0 ? "Aucun cours n’est disponible pour cette saison." : "Aucun cours ne correspond à votre recherche."}</p>{filtre && <button type="button" className="bouton-secondaire" onClick={() => setFiltre("")}>Effacer le filtre</button>}</li>}
            {coursTries.map((c) => {
              const restantes = c.capaciteMax === null ? null : c.capaciteMax - c.inscrits;
              return (
                <li key={c.id} className={`border-b border-bordure last:border-0 ${adapte(c) ? "" : "opacity-60"}`}>
                  <label className="flex items-start gap-2 px-2 py-2 text-sm hover:bg-accent-doux/40 sm:items-center sm:py-1">
                    <input type="checkbox" className="mt-0.5 sm:mt-0" checked={coursIds.includes(c.id)} onChange={() => setCoursIds(basculer(coursIds, c.id))} />
                    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                      <span className="w-20 shrink-0">{c.jourSemaine ? JOURS[c.jourSemaine] : "Stage"}</span>
                      <span className="w-12 shrink-0 tabular-nums">{c.heureDebut}</span>
                      <span className="font-medium">{c.discipline}</span>
                      <span className="basis-full text-doux sm:basis-auto">
                        {c.dureeMinutes} min{c.niveau ? `, ${c.niveau}` : ""}, {c.salle}
                        {!adapte(c) && ", hors tranche d’âge"}
                      </span>
                    </span>
                    {restantes !== null && (
                      <span
                        className={`shrink-0 text-xs tabular-nums ${restantes <= 0 ? "rounded bg-alerte-fond px-1.5 font-medium text-alerte-texte" : "text-doux"}`}
                      >
                        {restantes <= 0 ? "complet" : `${restantes} place${restantes > 1 ? "s" : ""}`}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          {choisis.length > 0 && (
            <ul aria-label="Cours choisis" className="flex flex-wrap gap-1.5">
              {choisis.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="rounded-md border border-accent bg-accent-doux px-2 py-0.5 text-xs hover:border-accent-fort"
                    onClick={() => setCoursIds(coursIds.filter((x) => x !== c.id))}
                    aria-label={`Retirer ${c.discipline} ${c.jourSemaine ? JOURS[c.jourSemaine] : ""} ${c.heureDebut}`}
                  >
                    {c.discipline} {c.jourSemaine ? JOURS[c.jourSemaine].slice(0, 3).toLowerCase() + "." : ""} {c.heureDebut} ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {chevauchements.length > 0 && (
            <p role="alert" className="rounded-md bg-alerte-fond px-2 py-1 text-xs text-alerte-texte">
              Horaires qui se chevauchent : {chevauchements.join(" ; ")}.
            </p>
          )}
        </fieldset>
      </div>

      <aside id="prix-inscription" aria-live="polite" aria-busy={calcul} className="panneau flex flex-col gap-3 self-start p-3 text-sm lg:sticky lg:top-16">
        <h2 className="font-semibold">Récapitulatif de l’inscription</h2>
        <div className="border-b border-bordure pb-3 text-xs text-doux">
          <p className="text-sm font-medium text-texte">{danseurs.filter((d) => danseurIds.includes(d.id)).map((d) => d.prenom).join(" et ") || "Aucun danseur sélectionné"}</p>
          <p>{PUBLICS.find(([v]) => v === publicChoisi)?.[1]} · {PERIODICITES.find(([v]) => v === periodicite)?.[1]}</p>
          <p>{choisis.length} cours · {choisis.reduce((total, c) => total + c.dureeMinutes, 0)} min par semaine</p>
        </div>
        {calcul && <p role="status" className="text-doux">Calcul du prix de votre sélection…</p>}
        {courant?.erreur && <div role="alert" className="flex flex-col gap-2 text-erreur"><p>Le prix n’a pas pu être calculé. Votre sélection est conservée.</p><button type="button" className="bouton-secondaire self-start" onClick={() => setEssaiCalcul((n) => n + 1)}>Réessayer le calcul</button></div>}
        {!resultat && !calcul && !courant?.erreur && <p className="text-doux">{danseurIds.length === 0 ? "Choisissez d’abord un danseur." : "Choisissez au moins un cours pour connaître le prix."}</p>}
        {resultat?.statut === "invalide" && <p role="alert">{resultat.message}</p>}
        {nouvelle?.statut === "erreur" && <p role="alert">{nouvelle.erreur.message}</p>}
        {nouvelle?.statut === "ok" && (
          <dl className="flex flex-col gap-1">
            <div className="flex justify-between gap-2">
              <dt>Forfait {nouvelle.libelleForfait}</dt>
              <dd className="tabular-nums">{formaterEuros(nouvelle.prixBrutCentimes)}</dd>
            </div>
            {nouvelle.reductions.map((r) => (
              <div key={r.code} className={r.statut === "ecartee" ? "text-doux" : ""}>
                <div className="flex justify-between gap-2">
                  <dt>Réduction {r.code}{r.statut === "ecartee" ? " (écartée)" : ""}</dt>
                  <dd className="tabular-nums">{r.statut === "appliquee" ? `−${formaterEuros(r.montantCentimes)}` : "—"}</dd>
                </div>
                <p className="text-xs">{r.motif}</p>
              </div>
            ))}
            <div className="mt-2 flex justify-between gap-2 border-t border-bordure pt-3 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formaterEuros(nouvelle.prixNetCentimes)}</dd>
            </div>
          </dl>
        )}
        {resultat?.statut === "ok" &&
          resultat.autres.map((a) => (
            <p key={a.reference} className="rounded bg-alerte-fond p-2 text-xs text-alerte-texte">
              L’inscription déjà enregistrée de {a.danseurs} aurait une remise de {formaterEuros(a.remiseRecalculee)} au lieu de{" "}
              {formaterEuros(a.remiseEnregistree)} : à régulariser par un avoir si l’école le décide.
            </p>
          ))}
        {refus && <p role="alert" className="text-erreur">{refus}</p>}
        <button type="submit" className="bouton-principal" disabled={!peutEnregistrer}>
          {envoi ? "Enregistrement…" : "Enregistrer l’inscription"}
        </button>
        <p className="text-xs text-doux">Vérifiez le prix avant d’enregistrer. Aucun paiement n’est encaissé à cette étape.</p>
        <p className="hidden text-center text-xs text-doux sm:block">ou Ctrl + Entrée</p>
      </aside>
    </form>
  );
}
