"use client";

import { Badge, Button, Checkbox, Group, NumberInput, Paper, Select, Text, TextInput, Title } from "@mantine/core";
import { useState, useTransition } from "react";
import type { SiteRow } from "@/db/settings";
import { type ActionResult, settle } from "@/lib/action-result";
import { ConfirmRemoval, type Removal } from "../../_ui/confirm-removal";
import { EscapeCancelsForm } from "../../_ui/escape-asks";
import { useFocusAfter } from "../../_ui/use-focus-after";
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
  const [removal, setRemoval] = useState<Removal | null>(null);
  const focusAfter = useFocusAfter();
  // Leaving an edit (saved, « Annuler », Escape): focus goes back to its « Modifier ».
  const closeSite = (id: string) => {
    focusAfter(`[data-edit="${id}"]`);
    setEditionSite(null);
  };
  const closeRoom = (id: string) => {
    focusAfter(`[data-edit="${id}"]`);
    setRoomEdition(null);
  };
  // A refusal or a lost connection keeps what was typed, with its message (#243).
  const act = (action: () => Promise<ActionResult>, after?: () => void, failed?: () => void) =>
    startTransition(async () => {
      const r = await settle(action);
      setMessage(r.ok ? null : r.message);
      if (r.ok) after?.();
      else failed?.();
    });

  return (
    <div className="flex flex-col gap-5">
      <ConfirmRemoval removal={removal} onClose={() => setRemoval(null)} />
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      {seats.map((s) => {
        const next = nextItems[s.id] ?? { name: "", capacity: "" };
        return (
          <Paper
            withBorder
            component="section"
            key={s.id}
            aria-labelledby={`site-${s.id}`}
            p="md"
            className="flex flex-col gap-3 text-sm"
          >
            {editionSite?.id === s.id ? (
              // Escape cancels, asking first if anything was changed (#339).
              <EscapeCancelsForm
                close={() => closeSite(s.id)}
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
                    () => closeSite(s.id),
                  );
                }}
              >
                <TextInput
                  label="Nom"
                  autoFocus
                  value={editionSite.name}
                  onChange={(e) => setEditionSite({ ...editionSite, name: e.currentTarget.value })}
                />
                <TextInput
                  label="Adresse"
                  value={editionSite.address}
                  onChange={(e) => setEditionSite({ ...editionSite, address: e.currentTarget.value })}
                />
                <Checkbox
                  className="pb-2"
                  label="Accueil sur place"
                  checked={editionSite.permanence}
                  onChange={(e) => setEditionSite({ ...editionSite, permanence: e.currentTarget.checked })}
                />
                <Group gap="xs" wrap="nowrap">
                  <Button type="submit" size="compact-sm" loading={inProgress}>
                    Enregistrer
                  </Button>
                  <Button type="button" size="compact-sm" variant="subtle" color="gray" onClick={() => closeSite(s.id)}>
                    Annuler
                  </Button>
                </Group>
              </EscapeCancelsForm>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Title order={2} size="h5" id={`site-${s.id}`} tabIndex={-1}>
                  {s.name}
                </Title>
                <Text span size="sm" c="dimmed">
                  {s.address}
                </Text>
                {s.permanence && <Badge variant="light">accueil sur place</Badge>}
                <Group gap="xs" className="ml-auto">
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    aria-label={`Modifier le site ${s.name}`}
                    data-edit={s.id}
                    onClick={() => setEditionSite(s)}
                  >
                    Modifier
                  </Button>
                  {s.rooms.length === 0 && (
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      color="red"
                      disabled={inProgress}
                      aria-label={`Retirer le site ${s.name}`}
                      data-remove={s.id}
                      onClick={() =>
                        setRemoval({
                          title: `Retirer le site ${s.name} ?`,
                          body: "Il n’a plus de salle. Ses horaires d’ouverture sont retirés avec lui.",
                          // The site goes away: focus moves to the first site left, or to the new-site form;
                          // refused, it stays on « Retirer » (or the first site, if it is already gone).
                          run: () =>
                            act(
                              () => removeSite(s.id),
                              () => focusAfter("section h2[tabindex]", "#new-site"),
                              () => focusAfter(`[data-remove="${s.id}"]`, "section h2[tabindex]", "#new-site"),
                            ),
                        })
                      }
                    >
                      Retirer
                    </Button>
                  )}
                </Group>
              </div>
            )}

            <SiteHours siteId={s.id} name={s.name} hours={s.hours} />

            <ul className="divide-y divide-bordure rounded-md border border-bordure">
              {s.rooms.map((x) =>
                roomEditing?.id === x.id ? (
                  <li key={x.id} className="px-3 py-2">
                    <EscapeCancelsForm
                      // Escape first closes an open list (the site choice), then cancels, asking first
                      // if anything was changed (#339).
                      close={() => closeRoom(x.id)}
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
                          () => closeRoom(x.id),
                        );
                      }}
                    >
                      <TextInput
                        label="Salle"
                        autoFocus
                        value={roomEditing.name}
                        onChange={(e) => setRoomEdition({ ...roomEditing, name: e.currentTarget.value })}
                      />
                      <NumberInput
                        label="Capacité"
                        w={96}
                        min={1}
                        allowDecimal={false}
                        value={roomEditing.capacity}
                        onChange={(v) => setRoomEdition({ ...roomEditing, capacity: String(v) })}
                      />
                      {seats.length > 1 && (
                        <Select
                          label="Site"
                          allowDeselect={false}
                          data={seats.map((l) => ({ value: l.id, label: l.name }))}
                          value={roomEditing.siteId}
                          onChange={(siteId) => siteId && setRoomEdition({ ...roomEditing, siteId })}
                        />
                      )}
                      <Button type="submit" size="compact-sm" loading={inProgress}>
                        Enregistrer
                      </Button>
                      <Button
                        type="button"
                        size="compact-sm"
                        variant="subtle"
                        color="gray"
                        onClick={() => closeRoom(x.id)}
                      >
                        Annuler
                      </Button>
                    </EscapeCancelsForm>
                  </li>
                ) : (
                  <li key={x.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
                    <span className="font-medium">{x.name}</span>
                    <Text span size="sm" c="dimmed">
                      {x.capacity ? `${x.capacity} places` : "capacité libre"}, {x.course} cours
                    </Text>
                    <Group gap="xs" className="ml-auto">
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        aria-label={`Modifier la salle ${x.name}`}
                        data-edit={x.id}
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
                      </Button>
                      {x.course === 0 && (
                        <Button
                          size="compact-sm"
                          variant="subtle"
                          color="red"
                          disabled={inProgress}
                          aria-label={`Retirer la salle ${x.name}`}
                          data-remove={x.id}
                          onClick={() =>
                            setRemoval({
                              title: `Retirer la salle ${x.name} ?`,
                              body: "Aucun cours n’y a lieu. Vous pourrez la recréer plus tard.",
                              // The room goes away: focus moves to its site's heading; refused, it stays on
                              // « Retirer » (or the heading, if the room is already gone).
                              run: () =>
                                act(
                                  () => removeRoom(x.id),
                                  () => focusAfter(`#site-${s.id}`),
                                  () => focusAfter(`[data-remove="${x.id}"]`, `#site-${s.id}`),
                                ),
                            })
                          }
                        >
                          Retirer
                        </Button>
                      )}
                    </Group>
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
                  <TextInput
                    label="Nouvelle salle"
                    value={next.name}
                    onChange={(e) => setNew({ ...nextItems, [s.id]: { ...next, name: e.currentTarget.value } })}
                  />
                  <NumberInput
                    label="Capacité"
                    w={96}
                    min={1}
                    allowDecimal={false}
                    value={next.capacity}
                    onChange={(v) => setNew({ ...nextItems, [s.id]: { ...next, capacity: String(v) } })}
                  />
                  <Button type="submit" variant="default" loading={inProgress} disabled={!next.name.trim()}>
                    Ajouter la salle
                  </Button>
                </form>
              </li>
            </ul>
          </Paper>
        );
      })}

      <Paper
        withBorder
        component="form"
        p="md"
        className="grid gap-3 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () => newSite(site),
            () => setSite({ name: "", address: "", permanence: false }),
          );
        }}
      >
        <Text size="sm" fw={600} className="sm:col-span-4">
          Nouveau site
        </Text>
        <TextInput
          id="new-site"
          label="Nom"
          value={site.name}
          onChange={(e) => setSite({ ...site, name: e.currentTarget.value })}
        />
        <TextInput
          label="Adresse"
          value={site.address}
          onChange={(e) => setSite({ ...site, address: e.currentTarget.value })}
        />
        <Checkbox
          className="pb-2"
          label="Accueil sur place"
          checked={site.permanence}
          onChange={(e) => setSite({ ...site, permanence: e.currentTarget.checked })}
        />
        <Button type="submit" loading={inProgress}>
          Ajouter le site
        </Button>
      </Paper>
    </div>
  );
}
