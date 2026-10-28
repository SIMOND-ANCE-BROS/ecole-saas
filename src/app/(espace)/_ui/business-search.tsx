"use client";

import { Alert, Badge, Combobox, Group, Loader, Text, TextInput, useCombobox } from "@mantine/core";
import { useEffect, useId, useState } from "react";
import type { Business } from "@/connectors/business-registry/registry";
import type { RegistrySearch } from "@/lib/business-search";

type Props = {
  label?: string;
  description: string;
  /** What picking fills, for the confirmation: « SIREN rempli. ». */
  filled: string | ((b: Business) => string);
  autoFocus?: boolean;
  /** A company chosen in the list: the form fills its own fields. */
  onPick: (b: Business) => void;
};

const DELAY_MS = 300;
const MIN = 3;
const UNAVAILABLE = "Recherche indisponible, saisissez à la main.";

/** « 000 000 001 », easier to compare with a paper document. */
const spacedSiren = (s: string) => s.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");

function Magnifier() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

async function search(q: string, signal: AbortSignal): Promise<RegistrySearch> {
  const response = await fetch(`/registre-entreprises?${new URLSearchParams({ q })}`, { signal });
  // A session that ended answers with the sign-in page, not JSON.
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
    return { ok: false, message: UNAVAILABLE };
  return (await response.json()) as RegistrySearch;
}

/**
 * Search in the business registry (#207), by name, SIREN or SIRET, while
 * typing. The text typed here is never sent with the form: picking a
 * company fills the form's own fields, which stay editable, and a registry
 * that does not answer only asks to type by hand.
 */
export function BusinessSearch({
  label = "Rechercher dans le registre des entreprises",
  description,
  filled,
  autoFocus,
  onPick,
}: Props) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const [text, setText] = useState("");
  const [results, setResults] = useState<Business[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ceased, setCeased] = useState(false);
  // Highlighted option, told to screen readers (Mantine only tracks the arrow
  // keys): the one reached with the arrows, else the first open company.
  const [moved, setMoved] = useState<number | null>(null);
  const optionId = useId();
  const idOf = (i: number) => `${optionId}-${i}`;
  const firstOpen = results.findIndex((b) => !b.ceased);
  const active = combobox.dropdownOpened ? (moved ?? firstOpen) : -1;
  const short = text.trim().length > 0 && text.trim().length < MIN;

  // Each new text cancels the search of the previous one.
  useEffect(() => {
    const q = text.trim();
    if (q.length < MIN) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      search(q, abort.signal)
        .then((r) => {
          // A newer text has replaced this search: its answer is not shown.
          if (abort.signal.aborted) return;
          if (r.ok) {
            setMoved(null);
            setResults(r.results);
            setMessage(r.results.length === 0 ? "Aucune entreprise trouvée." : null);
            if (r.results.length > 0) combobox.openDropdown();
          } else {
            setMoved(null);
            setResults([]);
            setMessage(r.message);
            combobox.closeDropdown();
          }
          setSearching(false);
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          setMoved(null);
          setResults([]);
          setMessage(UNAVAILABLE);
          setSearching(false);
        });
    }, DELAY_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
    // combobox: methods of a store, not a dependency of the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Once the list is drawn: Enter takes the first company still open, never a closed one.
  useEffect(() => {
    const first = results.findIndex((b) => !b.ceased);
    if (first >= 0 && combobox.dropdownOpened) combobox.selectOption(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, combobox.dropdownOpened]);

  const pick = (siren: string) => {
    const b = results.find((r) => r.siren === siren);
    if (!b) return;
    onPick(b);
    setText("");
    setMoved(null);
    setResults([]);
    setCeased(b.ceased);
    setMessage(`${b.legalName} : ${typeof filled === "string" ? filled : filled(b)}`);
    combobox.closeDropdown();
  };

  return (
    <div>
      <Combobox store={combobox} onOptionSubmit={pick}>
        <Combobox.Target
          withExpandedAttribute
          aria-activedescendant={combobox.dropdownOpened && active >= 0 ? idOf(active) : undefined}
        >
          <TextInput
            role="combobox"
            label={label}
            description={description}
            placeholder="ex. Danse Studio ou 552 032 534"
            value={text}
            autoComplete="off"
            autoFocus={autoFocus}
            leftSection={<Magnifier />}
            rightSection={searching ? <Loader size="xs" /> : null}
            onChange={(e) => {
              const t = e.currentTarget.value;
              setText(t);
              // The list belonged to the previous text: Enter cannot pick from it.
              setMoved(null);
              setResults([]);
              setCeased(false);
              combobox.resetSelectedOption();
              combobox.closeDropdown();
              setMessage(null);
              if (t.trim().length < MIN) setSearching(false);
            }}
            onFocus={() => results.length > 0 && combobox.openDropdown()}
            onBlur={() => combobox.closeDropdown()}
            onKeyDown={(e) => {
              // Enter in a search field never saves the form.
              if (e.key === "Enter") e.preventDefault();
              // After Mantine has moved the highlight.
              if (e.key === "ArrowDown" || e.key === "ArrowUp")
                setTimeout(() => setMoved(combobox.getSelectedOptionIndex()));
            }}
          />
        </Combobox.Target>
        <Combobox.Dropdown hidden={results.length === 0}>
          <Combobox.Options mah={320} style={{ overflowY: "auto" }}>
            {results.map((b, i) => (
              <Combobox.Option key={b.siren} value={b.siren} id={idOf(i)}>
                <Group gap="xs" wrap="nowrap" justify="space-between">
                  <div className="min-w-0">
                    <Text size="sm" fw={500} truncate>
                      {b.legalName}
                    </Text>
                    {/* The name's colour, lighter: stays readable on the highlighted option. */}
                    <Text size="xs" c="inherit" opacity={0.8}>
                      {[spacedSiren(b.siren), b.legalForm, b.city].filter(Boolean).join(" — ")}
                    </Text>
                  </div>
                  {b.ceased && (
                    // Neutral badge: readable on a highlighted row, light or dark.
                    <Badge variant="default" size="sm" className="shrink-0">
                      fermée
                    </Badge>
                  )}
                </Group>
              </Combobox.Option>
            ))}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      <Text size="xs" c="dimmed" mt={4} role="status" aria-live="polite">
        {short ? "Tapez au moins 3 caractères." : message}
      </Text>
      {ceased && (
        <Alert color="yellow" mt="xs" p="xs" role="status">
          Cette entreprise est fermée : vérifiez le SIREN.
        </Alert>
      )}
    </div>
  );
}
