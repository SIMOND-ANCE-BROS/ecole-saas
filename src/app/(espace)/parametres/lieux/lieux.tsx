"use client";

import { useState, useTransition } from "react";
import type { LigneSite } from "@/db/parametres";
import { changerSalle, changerSite, nouveauSite, nouvelleSalle, retirerSalle, retirerSite } from "../actions";

const capaciteDe = (v: string) => (v.trim() === "" ? null : Number(v));

export function Lieux({ lieux }: { lieux: LigneSite[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const [site, setSite] = useState({ nom: "", adresse: "", permanence: false });
  const [editionSite, setEditionSite] = useState<{ id: string; nom: string; adresse: string; permanence: boolean } | null>(null);
  const [editionSalle, setEditionSalle] = useState<{ id: string; siteId: string; nom: string; capacite: string } | null>(null);
  const [nouvelles, setNouvelles] = useState<Record<string, { nom: string; capacite: string }>>({});
  const agir = (action: () => Promise<{ message: string | null }>, apres?: () => void) =>
    demarrer(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) apres?.();
    });

  return (
    <div className="flex flex-col gap-5">
      {message && (
        <p role="alert" className="text-sm text-erreur">
          {message}
        </p>
      )}
      {lieux.map((s) => {
        const nouvelle = nouvelles[s.id] ?? { nom: "", capacite: "" };
        return (
          <section key={s.id} aria-labelledby={`site-${s.id}`} className="panneau flex flex-col gap-3 p-4 text-sm">
            {editionSite?.id === s.id ? (
              <form
                className="grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  agir(() => changerSite(s.id, { nom: editionSite.nom, adresse: editionSite.adresse, permanence: editionSite.permanence }), () => setEditionSite(null));
                }}
              >
                <div className="flex flex-col gap-1">
                  <label htmlFor={`site-nom-${s.id}`}>Nom</label>
                  <input id={`site-nom-${s.id}`} className="champ" value={editionSite.nom} onChange={(e) => setEditionSite({ ...editionSite, nom: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`site-adresse-${s.id}`}>Adresse</label>
                  <input id={`site-adresse-${s.id}`} className="champ" value={editionSite.adresse} onChange={(e) => setEditionSite({ ...editionSite, adresse: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 pb-2">
                  <input type="checkbox" checked={editionSite.permanence} onChange={(e) => setEditionSite({ ...editionSite, permanence: e.target.checked })} />
                  Accueil sur place
                </label>
                <span className="flex gap-2 pb-2">
                  <button type="submit" className="lien" disabled={enCours}>
                    Enregistrer
                  </button>
                  <button type="button" className="lien text-doux" onClick={() => setEditionSite(null)}>
                    Annuler
                  </button>
                </span>
              </form>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 id={`site-${s.id}`} className="text-base font-semibold">
                  {s.nom}
                </h2>
                <span className="text-doux">{s.adresse}</span>
                {s.permanence && <span className="rounded bg-accent-doux px-1.5 text-xs">accueil sur place</span>}
                <span className="ml-auto flex gap-3">
                  <button type="button" className="lien" onClick={() => setEditionSite(s)}>
                    Modifier
                  </button>
                  {s.salles.length === 0 && (
                    <button type="button" className="lien text-doux" disabled={enCours} onClick={() => agir(() => retirerSite(s.id))}>
                      Retirer
                    </button>
                  )}
                </span>
              </div>
            )}

            <ul className="divide-y divide-bordure rounded-md border border-bordure">
              {s.salles.map((x) =>
                editionSalle?.id === x.id ? (
                  <li key={x.id} className="px-3 py-2">
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        agir(
                          () => changerSalle(x.id, { siteId: editionSalle.siteId, nom: editionSalle.nom, capacite: capaciteDe(editionSalle.capacite) }),
                          () => setEditionSalle(null),
                        );
                      }}
                    >
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`salle-nom-${x.id}`}>Salle</label>
                        <input id={`salle-nom-${x.id}`} className="champ" value={editionSalle.nom} onChange={(e) => setEditionSalle({ ...editionSalle, nom: e.target.value })} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`salle-cap-${x.id}`}>Capacité</label>
                        <input id={`salle-cap-${x.id}`} type="number" min={1} className="champ w-24" value={editionSalle.capacite} onChange={(e) => setEditionSalle({ ...editionSalle, capacite: e.target.value })} />
                      </div>
                      {lieux.length > 1 && (
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`salle-site-${x.id}`}>Site</label>
                          <select id={`salle-site-${x.id}`} className="champ" value={editionSalle.siteId} onChange={(e) => setEditionSalle({ ...editionSalle, siteId: e.target.value })}>
                            {lieux.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.nom}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <button type="submit" className="lien pb-2" disabled={enCours}>
                        Enregistrer
                      </button>
                      <button type="button" className="lien pb-2 text-doux" onClick={() => setEditionSalle(null)}>
                        Annuler
                      </button>
                    </form>
                  </li>
                ) : (
                  <li key={x.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                    <span className="font-medium">{x.nom}</span>
                    <span className="text-doux">
                      {x.capacite ? `${x.capacite} places` : "capacité libre"}, {x.cours} cours
                    </span>
                    <span className="ml-auto flex gap-3">
                      <button type="button" className="lien" onClick={() => setEditionSalle({ id: x.id, siteId: s.id, nom: x.nom, capacite: x.capacite?.toString() ?? "" })}>
                        Modifier
                      </button>
                      {x.cours === 0 && (
                        <button type="button" className="lien text-doux" disabled={enCours} onClick={() => agir(() => retirerSalle(x.id))}>
                          Retirer
                        </button>
                      )}
                    </span>
                  </li>
                ),
              )}
              <li className="px-3 py-2">
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    agir(
                      () => nouvelleSalle({ siteId: s.id, nom: nouvelle.nom, capacite: capaciteDe(nouvelle.capacite) }),
                      () => setNouvelles({ ...nouvelles, [s.id]: { nom: "", capacite: "" } }),
                    );
                  }}
                >
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`nouvelle-salle-${s.id}`}>Nouvelle salle</label>
                    <input
                      id={`nouvelle-salle-${s.id}`}
                      className="champ"
                      value={nouvelle.nom}
                      onChange={(e) => setNouvelles({ ...nouvelles, [s.id]: { ...nouvelle, nom: e.target.value } })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`nouvelle-cap-${s.id}`}>Capacité</label>
                    <input
                      id={`nouvelle-cap-${s.id}`}
                      type="number"
                      min={1}
                      className="champ w-24"
                      value={nouvelle.capacite}
                      onChange={(e) => setNouvelles({ ...nouvelles, [s.id]: { ...nouvelle, capacite: e.target.value } })}
                    />
                  </div>
                  <button type="submit" className="bouton-secondaire" disabled={enCours || !nouvelle.nom.trim()}>
                    Ajouter la salle
                  </button>
                </form>
              </li>
            </ul>
          </section>
        );
      })}

      <form
        className="panneau grid gap-3 p-4 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          agir(() => nouveauSite(site), () => setSite({ nom: "", adresse: "", permanence: false }));
        }}
      >
        <p className="text-sm font-semibold sm:col-span-4">Nouveau site</p>
        <div className="flex flex-col gap-1">
          <label htmlFor="site-nom" className="text-sm font-medium">
            Nom
          </label>
          <input id="site-nom" className="champ" value={site.nom} onChange={(e) => setSite({ ...site, nom: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="site-adresse" className="text-sm font-medium">
            Adresse
          </label>
          <input id="site-adresse" className="champ" value={site.adresse} onChange={(e) => setSite({ ...site, adresse: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={site.permanence} onChange={(e) => setSite({ ...site, permanence: e.target.checked })} />
          Accueil sur place
        </label>
        <button type="submit" className="bouton-principal" disabled={enCours}>
          Ajouter le site
        </button>
      </form>
    </div>
  );
}
