"use client";

import { useState, useTransition } from "react";
import { ajouterIndispo, retirerIndispo } from "../actions";

export type IndispoAffichee = { id: string; debut: string; fin: string; origine: "saisie" | "google" | "microsoft"; libelle: string | null };

const ORIGINE = { saisie: null, google: "Google Agenda", microsoft: "Microsoft" } as const;
const jour = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });
const heure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** « mer. 4 nov., 16:30 à 19:00 », ou « mer. 4 nov. au ven. 6 nov. » pour des journées entières. */
function plage(debutIso: string, finIso: string): string {
  const debut = new Date(debutIso);
  const fin = new Date(finIso);
  const minuit = (d: Date) => heure.format(d) === "00:00";
  if (minuit(debut) && minuit(fin)) {
    const dernier = new Date(fin.getTime() - 1);
    return jour.format(debut) === jour.format(dernier) ? `${jour.format(debut)}, journée` : `${jour.format(debut)} au ${jour.format(dernier)}`;
  }
  return jour.format(debut) === jour.format(fin)
    ? `${jour.format(debut)}, ${heure.format(debut)} à ${heure.format(fin)}`
    : `${jour.format(debut)} ${heure.format(debut)} au ${jour.format(fin)} ${heure.format(fin)}`;
}

/** Indisponibilités à venir d'un intervenant ; celles d'un agenda connecté ne se retirent pas ici. */
export function Indisponibilites({ intervenantId, prenom, indispos }: { intervenantId: string; prenom: string; indispos: IndispoAffichee[] }) {
  const [v, setV] = useState({ du: "", au: "", de: "", a: "", libelle: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const maj = (champ: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [champ]: e.target.value });

  return (
    <section aria-labelledby="indisponibilites" className="panneau flex min-w-0 flex-col gap-3 p-4 text-sm">
      <div>
        <h2 id="indisponibilites" className="text-base font-semibold">
          Indisponibilités de {prenom}
        </h2>
        <p className="text-doux">Elles signalent les séances en conflit et écartent {prenom} des remplaçants proposés.</p>
      </div>

      {indispos.length === 0 ? (
        <p className="text-doux">Aucune indisponibilité à venir.</p>
      ) : (
        <ul className="divide-y divide-bordure rounded-md border border-bordure">
          {indispos.map((i) => (
            <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
              <span className="tabular-nums">{plage(i.debut, i.fin)}</span>
              {i.libelle && <span className="text-doux">{i.libelle}</span>}
              {ORIGINE[i.origine] ? (
                <span className="ml-auto text-xs text-doux">{ORIGINE[i.origine]}</span>
              ) : (
                <button
                  type="button"
                  className="lien ml-auto text-xs text-doux"
                  disabled={enCours}
                  onClick={() => demarrer(async () => setMessage((await retirerIndispo(intervenantId, i.id)).message))}
                >
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-2 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          demarrer(async () => {
            const { message: erreur } = await ajouterIndispo(intervenantId, { ...v, au: v.au || v.du });
            setMessage(erreur);
            if (!erreur) setV({ du: "", au: "", de: "", a: "", libelle: "" });
          });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="indispo-du" className="font-medium">
            Du
          </label>
          <input id="indispo-du" type="date" className="champ" required value={v.du} onChange={maj("du")} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="indispo-au" className="font-medium">
            Au (inclus)
          </label>
          <input id="indispo-au" type="date" className="champ" min={v.du} value={v.au} onChange={maj("au")} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="indispo-de" className="font-medium">
            De (facultatif)
          </label>
          <input id="indispo-de" type="time" className="champ" value={v.de} onChange={maj("de")} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="indispo-a" className="font-medium">
            À
          </label>
          <input id="indispo-a" type="time" className="champ" value={v.a} onChange={maj("a")} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-3">
          <label htmlFor="indispo-libelle" className="font-medium">
            Motif (facultatif)
          </label>
          <input id="indispo-libelle" className="champ" placeholder="Stage, congé, rendez-vous…" value={v.libelle} onChange={maj("libelle")} />
        </div>
        <button type="submit" className="bouton-secondaire self-end" disabled={enCours}>
          Ajouter
        </button>
      </form>
      <p className="text-xs text-doux">Sans heures : journées entières. Heures de Paris.</p>
      {message && (
        <p role="alert" className="text-erreur">
          {message}
        </p>
      )}
    </section>
  );
}
