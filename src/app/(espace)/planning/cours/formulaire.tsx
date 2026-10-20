"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { type CoursEdite, type ReferentielPlanning, TYPES_COURS } from "@/db/cours";
import type { CoursPlanning } from "@/db/planning";
import { conflits } from "@/domaine/planning/chevauchement";
import { enregistrerCours, type Refus, supprimer, verifierCreneau } from "./actions";

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const DUREES = [45, 60, 90, 120];
const NOUVELLE = "nouvelle";
const dateCourte = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

type Props = {
  cours: CoursEdite | null;
  referentiel: ReferentielPlanning;
  planning: CoursPlanning[];
  /** Jour proposé pour un nouveau cours (lien « + » d'une colonne du planning). */
  jour?: number;
  /** Créneau proposé depuis la vue agenda. */
  heure?: string;
  duree?: number;
};

const entier = (v: string) => (v.trim() === "" ? null : Number(v));

export function FormulaireCours({ cours, referentiel, planning, jour, heure, duree }: Props) {
  const r = referentiel;
  const [v, setV] = useState({
    discipline: cours?.discipline ?? "",
    salleId: cours?.salleId ?? r.salles[0]?.id ?? NOUVELLE,
    nouvelleSalle: "",
    capaciteSalle: "",
    siteId: r.sites[0]?.id ?? NOUVELLE,
    nouveauSite: "",
    adresseSite: "",
    intervenantId: cours?.intervenantId ?? r.intervenants[0]?.id ?? "",
    type: cours?.type ?? "collectif",
    jourSemaine: String(cours?.jourSemaine ?? jour ?? 1),
    heureDebut: cours?.heureDebut ?? heure ?? "17:00",
    dureeMinutes: String(cours?.dureeMinutes ?? duree ?? 60),
    ageMin: cours?.ageMin?.toString() ?? "",
    ageMax: cours?.ageMax?.toString() ?? "",
    niveau: cours?.niveau ?? "",
    capaciteMax: cours?.capaciteMax?.toString() ?? "",
  });
  const [refus, setRefus] = useState<Refus | null>(null);
  const [envoi, demarrer] = useTransition();
  const formulaire = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (refus) formulaire.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [refus]);
  const [confirmerSuppression, setConfirmer] = useState(false);
  const maj = (champ: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [champ]: e.target.value });

  const stage = v.type === "stage";
  const salleChoisie = r.salles.find((s) => s.id === v.salleId);
  const disciplineExistante = r.disciplines.find((d) => d.nom.toLowerCase() === v.discipline.trim().toLowerCase());

  const saisie = {
    discipline: disciplineExistante ? { id: disciplineExistante.id } : { nom: v.discipline },
    salle:
      v.salleId !== NOUVELLE
        ? { id: v.salleId }
        : {
            nom: v.nouvelleSalle,
            capacite: entier(v.capaciteSalle),
            site: v.siteId !== NOUVELLE ? { id: v.siteId } : { nom: v.nouveauSite, adresse: v.adresseSite },
          },
    intervenantId: v.intervenantId,
    type: v.type,
    jourSemaine: stage ? null : Number(v.jourSemaine),
    heureDebut: v.heureDebut,
    dureeMinutes: Number(v.dureeMinutes),
    ageMin: entier(v.ageMin),
    ageMax: entier(v.ageMax),
    niveau: v.niveau,
    capaciteMax: entier(v.capaciteMax),
  };

  const recouvrements = conflits(
    { id: cours?.id ?? null, jourSemaine: saisie.jourSemaine, heureDebut: v.heureDebut, dureeMinutes: saisie.dureeMinutes || 0, salleId: v.salleId, intervenantId: v.intervenantId },
    planning,
  ).map((c) => {
    const autre = planning.find((p) => p.id === c.id)!;
    const quoi = [c.salle && `la salle ${autre.salle}`, c.intervenant && autre.intervenant].filter(Boolean).join(" et ");
    return `${quoi} : ${autre.discipline} à ${autre.heureDebut}`;
  });

  // Indisponibilités de l'intervenant sur les dates à venir du créneau, vérifiées côté serveur après une pause.
  const [datesIndispo, setDatesIndispo] = useState<string[]>([]);
  const cle = stage ? "" : `${v.intervenantId}|${v.jourSemaine}|${v.heureDebut}|${v.dureeMinutes}`;
  useEffect(() => {
    if (!cle) return;
    const [intervenantId, jour, heure, duree] = cle.split("|");
    const minuteur = setTimeout(async () => {
      setDatesIndispo(await verifierCreneau(cours?.id ?? null, { intervenantId, jourSemaine: Number(jour), heureDebut: heure, dureeMinutes: Number(duree) }));
    }, 300);
    return () => clearTimeout(minuteur);
  }, [cle, cours?.id]);
  const indispoAffichees = cle ? datesIndispo : [];
  const intervenantChoisi = r.intervenants.find((i) => i.id === v.intervenantId);

  const erreur = (champ: string) =>
    refus?.erreurs[champ] && (
      <p id={`${champ}-erreur`} className="text-xs text-erreur">
        {refus.erreurs[champ]}
      </p>
    );
  const invalide = (champ: string) =>
    refus?.erreurs[champ] ? { "aria-invalid": true, "aria-describedby": `${champ}-erreur` } : {};
  const libelle = (pour: string, texte: string) => (
    <label htmlFor={pour} className="text-sm font-medium">
      {texte}
    </label>
  );

  return (
    <form
      ref={formulaire}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        demarrer(async () => setRefus(await enregistrerCours(cours?.id ?? null, saisie)));
      }}
    >
      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Cours</legend>
        <div className="flex flex-col gap-1">
          {libelle("discipline", "Discipline")}
          <input
            id="discipline"
            className="champ"
            list="disciplines"
            autoComplete="off"
            autoFocus={!cours}
            value={v.discipline}
            onChange={maj("discipline")}
            {...invalide("discipline")}
          />
          <datalist id="disciplines">
            {r.disciplines.map((d) => (
              <option key={d.id} value={d.nom} />
            ))}
          </datalist>
          {v.discipline.trim() && !disciplineExistante ? (
            <p className="text-xs text-doux">Nouvelle discipline : elle sera créée.</p>
          ) : (
            erreur("discipline")
          )}
        </div>
        <div className="flex flex-col gap-1">
          {libelle("niveau", "Niveau (facultatif)")}
          <input id="niveau" className="champ" autoComplete="off" placeholder="Débutant, Adultes…" value={v.niveau} onChange={maj("niveau")} />
        </div>
        <div className="flex flex-col gap-1">
          {libelle("intervenant", "Intervenant")}
          <select id="intervenant" className="champ" value={v.intervenantId} onChange={maj("intervenantId")} {...invalide("intervenantId")}>
            {r.intervenants.map((i) => (
              <option key={i.id} value={i.id}>
                {i.prenom} {i.nom}
                {i.actif ? "" : " (inactif)"}
              </option>
            ))}
          </select>
          {r.intervenants.length === 0 && (
            <p className="text-xs text-erreur">
              Aucun intervenant actif :{" "}
              <Link href="/intervenants/nouveau" className="lien">
                en ajouter un
              </Link>
              .
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {libelle("type", "Type")}
          <select id="type" className="champ" value={v.type} onChange={maj("type")}>
            {Object.entries(TYPES_COURS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Créneau</legend>
        {!stage && (
          <div className="flex flex-col gap-1">
            {libelle("jour", "Jour")}
            <select id="jour" className="champ" value={v.jourSemaine} onChange={maj("jourSemaine")}>
              {JOURS.slice(1).map((j, i) => (
                <option key={j} value={i + 1}>
                  {j}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          {libelle("heure", "Début")}
          <input id="heure" type="time" step={300} className="champ" value={v.heureDebut} onChange={maj("heureDebut")} {...invalide("heureDebut")} />
          {erreur("heureDebut")}
        </div>
        <div className="flex flex-col gap-1">
          {libelle("duree", "Durée (minutes)")}
          <input id="duree" type="number" min={5} step={5} className="champ" value={v.dureeMinutes} onChange={maj("dureeMinutes")} {...invalide("dureeMinutes")} />
          <div className="flex gap-1" role="group" aria-label="Durées courantes">
            {DUREES.map((d) => (
              <button
                key={d}
                type="button"
                className={`rounded border px-1.5 text-xs ${String(d) === v.dureeMinutes ? "border-accent bg-accent-doux" : "border-bordure text-doux hover:border-accent"}`}
                onClick={() => setV({ ...v, dureeMinutes: String(d) })}
              >
                {d}
              </button>
            ))}
          </div>
          {erreur("dureeMinutes")}
        </div>
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Lieu</legend>
        <div className="flex flex-col gap-1 sm:col-span-2">
          {libelle("salle", "Salle")}
          <select id="salle" className="champ" value={v.salleId} onChange={maj("salleId")}>
            {r.salles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}, {s.site}
                {s.capacite ? ` (${s.capacite} places)` : ""}
              </option>
            ))}
            <option value={NOUVELLE}>Nouvelle salle…</option>
          </select>
          {erreur("salle")}
        </div>
        {v.salleId === NOUVELLE && (
          <>
            <div className="flex flex-col gap-1">
              {libelle("nouvelle-salle", "Nom de la salle")}
              <input id="nouvelle-salle" className="champ" autoComplete="off" value={v.nouvelleSalle} onChange={maj("nouvelleSalle")} />
            </div>
            <div className="flex flex-col gap-1">
              {libelle("capacite-salle", "Capacité de la salle (facultatif)")}
              <input id="capacite-salle" type="number" min={1} className="champ" value={v.capaciteSalle} onChange={maj("capaciteSalle")} />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              {libelle("site", "Site")}
              <select id="site" className="champ" value={v.siteId} onChange={maj("siteId")}>
                {r.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom}
                  </option>
                ))}
                <option value={NOUVELLE}>Nouveau site…</option>
              </select>
            </div>
            {v.siteId === NOUVELLE && (
              <>
                <div className="flex flex-col gap-1">
                  {libelle("nouveau-site", "Nom du site")}
                  <input id="nouveau-site" className="champ" autoComplete="off" value={v.nouveauSite} onChange={maj("nouveauSite")} />
                </div>
                <div className="flex flex-col gap-1">
                  {libelle("adresse-site", "Adresse du site")}
                  <input id="adresse-site" className="champ" autoComplete="off" value={v.adresseSite} onChange={maj("adresseSite")} />
                </div>
              </>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Public</legend>
        <div className="flex flex-col gap-1">
          {libelle("age-min", "Âge minimum")}
          <input id="age-min" type="number" min={0} className="champ" value={v.ageMin} onChange={maj("ageMin")} />
        </div>
        <div className="flex flex-col gap-1">
          {libelle("age-max", "Âge maximum")}
          <input id="age-max" type="number" min={0} className="champ" value={v.ageMax} onChange={maj("ageMax")} {...invalide("ageMax")} />
          {erreur("ageMax")}
        </div>
        <div className="flex flex-col gap-1">
          {libelle("capacite", "Places")}
          <input
            id="capacite"
            type="number"
            min={1}
            className="champ"
            placeholder={salleChoisie?.capacite ? `${salleChoisie.capacite} (salle)` : "sans limite"}
            value={v.capaciteMax}
            onChange={maj("capaciteMax")}
          />
        </div>
      </fieldset>

      {indispoAffichees.length > 0 && (
        <div role="status" className="rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          <p className="font-medium">
            {intervenantChoisi?.prenom} est indisponible {indispoAffichees.length > 1 ? `${indispoAffichees.length} fois` : "une fois"} sur ce créneau :
          </p>
          <p>
            {indispoAffichees.slice(0, 6).map((d) => dateCourte.format(new Date(`${d}T00:00:00Z`))).join(", ")}
            {indispoAffichees.length > 6 && "…"}
          </p>
        </div>
      )}

      {recouvrements.length > 0 && (
        <div role="status" className="rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          <p className="font-medium">Ce créneau est déjà occupé :</p>
          <ul className="list-disc pl-5">
            {recouvrements.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {refus && (
        <p tabIndex={-1} role="alert" className="text-sm text-erreur">
          {refus.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
        <button type="submit" className="bouton-principal" disabled={envoi}>
          {envoi ? "Enregistrement…" : cours ? "Enregistrer les modifications" : "Créer le cours"}
        </button>
        <Link href={cours ? `/planning/cours/${cours.id}` : "/planning"} className="bouton-secondaire">
          Annuler
        </Link>
        {cours &&
          (confirmerSuppression ? (
            <span className="ml-auto flex items-center gap-2 text-sm">
              Supprimer ce cours ?
              <button
                type="button"
                className="rounded-md border border-erreur px-3 py-1.5 text-sm font-medium text-erreur hover:bg-erreur/10 disabled:opacity-50"
                disabled={envoi}
                onClick={() =>
                  demarrer(async () => {
                    setRefus(await supprimer(cours.id));
                    setConfirmer(false);
                  })
                }
              >
                Oui, supprimer
              </button>
              <button type="button" className="bouton-secondaire" onClick={() => setConfirmer(false)}>
                Non
              </button>
            </span>
          ) : (
            <button type="button" className="lien ml-auto text-sm text-erreur" onClick={() => setConfirmer(true)}>
              Supprimer le cours
            </button>
          ))}
      </div>
    </form>
  );
}
