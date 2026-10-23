"use client";

import { useState, useTransition } from "react";
import type { SiteRow } from "@/db/settings";
import { changeRoom, changeSite, newSite, newRoom, removeRoom, removeSite } from "../actions";
import { SiteHours } from "./site-hours";

const capacityOf = (v: string) => (v.trim() === "" ? null : Number(v));

export function Places({ seats: seats }: { seats: SiteRow[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const [site, setSite] = useState({ name: "", address: "", permanence: false });
  const [editionSite, setEditionSite] = useState<{
    id: string;
    name: string;
    address: string;
    permanence: boolean;
  } | null>(null);
  const [roomEditing, setRoomEdition] = useState<{
    id: string;
    siteId: string;
    name: string;
    capacity: string;
  } | null>(null);
  const [nextItems, setNew] = useState<Record<string, { name: string; capacity: string }>>({});
  const act = (action: () => Promise<{ message: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) after?.();
    });

  return (
    <div className="flex flex-col gap-5">
      {message && (
        <p role="alert" className="text-sm text-erreur">
          {message}
        </p>
      )}
      {seats.map((s) => {
        const next = nextItems[s.id] ?? { name: "", capacity: "" };
        return (
          <section key={s.id} aria-labelledby={`site-${s.id}`} className="panneau flex flex-col gap-3 p-4 text-sm">
            {editionSite?.id === s.id ? (
              <form
                className="grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(
                    () =>
                      changeSite(s.id, {
                        name: editionSite.name,
                        address: editionSite.address,
                        permanence: editionSite.permanence,
                      }),
                    () => setEditionSite(null),
                  );
                }}
              >
                <div className="flex flex-col gap-1">
                  <label htmlFor={`site-nom-${s.id}`}>Nom</label>
                  <input
                    id={`site-nom-${s.id}`}
                    className="champ"
                    value={editionSite.name}
                    onChange={(e) => setEditionSite({ ...editionSite, name: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`site-adresse-${s.id}`}>Adresse</label>
                  <input
                    id={`site-adresse-${s.id}`}
                    className="champ"
                    value={editionSite.address}
                    onChange={(e) => setEditionSite({ ...editionSite, address: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 pb-2">
                  <input
                    type="checkbox"
                    checked={editionSite.permanence}
                    onChange={(e) => setEditionSite({ ...editionSite, permanence: e.target.checked })}
                  />
                  Accueil sur place
                </label>
                <span className="flex gap-2 pb-2">
                  <button type="submit" className="lien" disabled={inProgress}>
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
                  {s.name}
                </h2>
                <span className="text-doux">{s.address}</span>
                {s.permanence && <span className="rounded bg-accent-doux px-1.5 text-xs">accueil sur place</span>}
                <span className="ml-auto flex gap-3">
                  <button type="button" className="lien" onClick={() => setEditionSite(s)}>
                    Modifier
                  </button>
                  {s.salles.length === 0 && (
                    <button
                      type="button"
                      className="lien text-doux"
                      disabled={inProgress}
                      onClick={() => act(() => removeSite(s.id))}
                    >
                      Retirer
                    </button>
                  )}
                </span>
              </div>
            )}

            <SiteHours siteId={s.id} name={s.name} hours={s.hours} />

            <ul className="divide-y divide-bordure rounded-md border border-bordure">
              {s.salles.map((x) =>
                roomEditing?.id === x.id ? (
                  <li key={x.id} className="px-3 py-2">
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(
                          () =>
                            changeRoom(x.id, {
                              siteId: roomEditing.siteId,
                              name: roomEditing.name,
                              capacity: capacityOf(roomEditing.capacity),
                            }),
                          () => setRoomEdition(null),
                        );
                      }}
                    >
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`salle-nom-${x.id}`}>Salle</label>
                        <input
                          id={`salle-nom-${x.id}`}
                          className="champ"
                          value={roomEditing.name}
                          onChange={(e) => setRoomEdition({ ...roomEditing, name: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`salle-cap-${x.id}`}>Capacité</label>
                        <input
                          id={`salle-cap-${x.id}`}
                          type="number"
                          min={1}
                          className="champ w-24"
                          value={roomEditing.capacity}
                          onChange={(e) => setRoomEdition({ ...roomEditing, capacity: e.target.value })}
                        />
                      </div>
                      {seats.length > 1 && (
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`salle-site-${x.id}`}>Site</label>
                          <select
                            id={`salle-site-${x.id}`}
                            className="champ"
                            value={roomEditing.siteId}
                            onChange={(e) => setRoomEdition({ ...roomEditing, siteId: e.target.value })}
                          >
                            {seats.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <button type="submit" className="lien pb-2" disabled={inProgress}>
                        Enregistrer
                      </button>
                      <button type="button" className="lien pb-2 text-doux" onClick={() => setRoomEdition(null)}>
                        Annuler
                      </button>
                    </form>
                  </li>
                ) : (
                  <li key={x.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                    <span className="font-medium">{x.name}</span>
                    <span className="text-doux">
                      {x.capacity ? `${x.capacity} places` : "capacité libre"}, {x.course} cours
                    </span>
                    <span className="ml-auto flex gap-3">
                      <button
                        type="button"
                        className="lien"
                        onClick={() =>
                          setRoomEdition({
                            id: x.id,
                            siteId: s.id,
                            name: x.name,
                            capacity: x.capacity?.toString() ?? "",
                          })
                        }
                      >
                        Modifier
                      </button>
                      {x.course === 0 && (
                        <button
                          type="button"
                          className="lien text-doux"
                          disabled={inProgress}
                          onClick={() => act(() => removeRoom(x.id))}
                        >
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
                    act(
                      () => newRoom({ siteId: s.id, name: next.name, capacity: capacityOf(next.capacity) }),
                      () => setNew({ ...nextItems, [s.id]: { name: "", capacity: "" } }),
                    );
                  }}
                >
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`nouvelle-salle-${s.id}`}>Nouvelle salle</label>
                    <input
                      id={`nouvelle-salle-${s.id}`}
                      className="champ"
                      value={next.name}
                      onChange={(e) => setNew({ ...nextItems, [s.id]: { ...next, name: e.target.value } })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`nouvelle-cap-${s.id}`}>Capacité</label>
                    <input
                      id={`nouvelle-cap-${s.id}`}
                      type="number"
                      min={1}
                      className="champ w-24"
                      value={next.capacity}
                      onChange={(e) => setNew({ ...nextItems, [s.id]: { ...next, capacity: e.target.value } })}
                    />
                  </div>
                  <button type="submit" className="bouton-secondaire" disabled={inProgress || !next.name.trim()}>
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
          act(
            () => newSite(site),
            () => setSite({ name: "", address: "", permanence: false }),
          );
        }}
      >
        <p className="text-sm font-semibold sm:col-span-4">Nouveau site</p>
        <div className="flex flex-col gap-1">
          <label htmlFor="site-nom" className="text-sm font-medium">
            Nom
          </label>
          <input
            id="site-nom"
            className="champ"
            value={site.name}
            onChange={(e) => setSite({ ...site, name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="site-adresse" className="text-sm font-medium">
            Adresse
          </label>
          <input
            id="site-adresse"
            className="champ"
            value={site.address}
            onChange={(e) => setSite({ ...site, address: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={site.permanence}
            onChange={(e) => setSite({ ...site, permanence: e.target.checked })}
          />
          Accueil sur place
        </label>
        <button type="submit" className="bouton-principal" disabled={inProgress}>
          Ajouter le site
        </button>
      </form>
    </div>
  );
}
