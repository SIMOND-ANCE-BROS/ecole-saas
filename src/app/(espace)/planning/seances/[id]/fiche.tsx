"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { Appel } from "@/db/seances";
import { annuler, faireAppel, remplacer } from "../actions";

type Props = {
  appel: Omit<Appel, "danseurs"> & { danseurs: (Appel["danseurs"][number] & { age: number | null })[] };
  intervenants: { id: string; nom: string }[];
};

/**
 * Fiche d'appel au clavier : P ou A sur une ligne marque le danseur et passe à
 * la suivante, flèches haut et bas pour se déplacer, Ctrl + Entrée enregistre.
 */
export function FicheAppel({ appel, intervenants }: Props) {
  const [presences, setPresences] = useState<Record<string, boolean | null>>(
    Object.fromEntries(appel.danseurs.map((d) => [d.id, d.present])),
  );
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [enCours, demarrer] = useTransition();
  const lignes = useRef<(HTMLLIElement | null)[]>([]);
  const annulee = appel.statut === "annulee";

  const nonMarques = appel.danseurs.filter((d) => presences[d.id] === null).length;
  const presents = appel.danseurs.filter((d) => presences[d.id] === true).length;
  const marquer = (id: string, present: boolean) => setPresences((p) => ({ ...p, [id]: present }));
  const aller = (i: number) => lignes.current[Math.max(0, Math.min(i, appel.danseurs.length - 1))]?.focus();

  const agir = (action: () => Promise<{ message: string | null }>, succes: string) =>
    demarrer(async () => {
      const { message: erreur } = await action();
      setMessage(erreur ? { texte: erreur, erreur: true } : { texte: succes, erreur: false });
    });
  const enregistrer = () =>
    agir(
      () =>
        faireAppel(
          appel.id,
          appel.danseurs.filter((d) => presences[d.id] !== null).map((d) => ({ danseurId: d.id, present: presences[d.id] as boolean })),
        ),
      "Appel enregistré.",
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <div
        className="flex flex-col gap-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !annulee) {
            e.preventDefault();
            enregistrer();
          }
        }}
      >
        {annulee ? (
          <p className="rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">Séance annulée : pas d’appel.</p>
        ) : appel.danseurs.length === 0 ? (
          <p className="text-sm text-doux">Aucun danseur inscrit ou à l’essai dans ce cours.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button
                type="button"
                className="bouton-secondaire"
                onClick={() => setPresences(Object.fromEntries(appel.danseurs.map((d) => [d.id, true])))}
              >
                Tous présents
              </button>
              <span className="text-doux" aria-live="polite">
                {presents} présent{presents > 1 ? "s" : ""} sur {appel.danseurs.length}
                {nonMarques > 0 && `, ${nonMarques} à marquer`}
              </span>
              <span className="ml-auto hidden text-xs text-doux sm:inline">P présent, A absent, flèches pour se déplacer</span>
            </div>
            <ul className="panneau divide-y divide-bordure" aria-label="Danseurs">
              {appel.danseurs.map((d, i) => {
                const p = presences[d.id];
                return (
                  <li
                    key={d.id}
                    ref={(el) => {
                      lignes.current[i] = el;
                    }}
                    tabIndex={0}
                    aria-label={`${d.prenom} ${d.nom} : ${p === null ? "non marqué" : p ? "présent" : "absent"}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm outline-none focus:bg-accent-doux/50"
                    onKeyDown={(e) => {
                      const touche = e.key.toLowerCase();
                      if (touche === "p" || touche === "a") {
                        e.preventDefault();
                        marquer(d.id, touche === "p");
                        aller(i + 1);
                      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        aller(e.key === "ArrowDown" ? i + 1 : i - 1);
                      }
                    }}
                  >
                    <span className="min-w-40 flex-1">
                      <Link href={`/personnes/${d.id}`} className="lien font-medium" tabIndex={-1}>
                        {d.prenom} {d.nom}
                      </Link>
                      {d.age !== null && <span className="text-doux"> ({d.age} ans)</span>}
                      {d.statut === "essai" && <span className="ml-2 rounded bg-accent-doux px-1.5 text-xs">à l’essai</span>}
                      {d.notes && <span className="block text-xs text-alerte-texte">{d.notes}</span>}
                    </span>
                    <span className="flex gap-1" role="group" aria-label={`Présence de ${d.prenom}`}>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-pressed={p === true}
                        className="rounded-md border border-bordure px-3 py-1 text-sm aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-sur-accent"
                        onClick={() => marquer(d.id, true)}
                      >
                        Présent
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-pressed={p === false}
                        className="rounded-md border border-bordure px-3 py-1 text-sm aria-pressed:border-alerte-texte aria-pressed:bg-alerte-fond aria-pressed:text-alerte-texte"
                        onClick={() => marquer(d.id, false)}
                      >
                        Absent
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="bouton-principal" disabled={enCours} onClick={enregistrer}>
                {enCours ? "Enregistrement…" : "Enregistrer l’appel"}
              </button>
              <span className="text-xs text-doux">ou Ctrl + Entrée</span>
            </div>
          </>
        )}
        {message && (
          <p role={message.erreur ? "alert" : "status"} className={`text-sm ${message.erreur ? "text-erreur" : ""}`}>
            {message.texte}
          </p>
        )}
      </div>

      <aside className="panneau flex flex-col gap-3 self-start p-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="intervenant" className="font-medium">
            Intervenant de la séance
          </label>
          <select
            id="intervenant"
            className="champ"
            defaultValue={appel.intervenantId}
            disabled={enCours}
            onChange={(e) => agir(() => remplacer(appel.id, e.target.value), "Intervenant de la séance changé.")}
          >
            {intervenants.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nom}
                {i.id === appel.titulaireId ? " (titulaire)" : ""}
              </option>
            ))}
          </select>
          {appel.intervenantId !== appel.titulaireId && <p className="text-xs text-doux">Remplacement pour cette séance seulement.</p>}
        </div>
        <button
          type="button"
          className="lien self-start text-sm"
          disabled={enCours}
          onClick={() => agir(() => annuler(appel.id, !annulee), annulee ? "Séance rétablie." : "Séance annulée.")}
        >
          {annulee ? "Rétablir la séance" : "Annuler la séance"}
        </button>
      </aside>
    </div>
  );
}
