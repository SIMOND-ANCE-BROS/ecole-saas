"use client";

import { Badge, Combobox, Group, Loader, Text, TextInput, useCombobox } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { Business } from "@/connectors/business-registry/registry";
import { searchBusinesses } from "./registry-actions";

type Props = {
  label?: string;
  description?: string;
  /** A company chosen in the list: the form fills its own fields. */
  onPick: (b: Business) => void;
};

const DELAY_MS = 300;
const MIN = 3;

/** « 000 000 001 », easier to compare with a paper document. */
export const spacedSiren = (s: string) => s.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");

/**
 * Search in the business registry (#207), by name, SIREN or SIRET, while
 * typing. The text typed here is never sent with the form: picking a
 * company fills the form's own fields, which stay editable, and a registry
 * that does not answer only asks to type by hand.
 */
export function BusinessSearch({
  label = "Rechercher dans le registre des entreprises",
  description = "Nom, SIREN ou SIRET : choisir une entreprise remplit les champs.",
  onPick,
}: Props) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const [text, setText] = useState("");
  const [results, setResults] = useState<Business[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "done" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);
  // Only the answer to the last text typed is shown.
  const last = useRef(0);

  useEffect(() => {
    const q = text.trim();
    const call = ++last.current;
    if (q.length < MIN) return;
    const run = async () => {
      setStatus("searching");
      const r = await searchBusinesses(q);
      if (call !== last.current) return;
      if (r.ok) {
        setResults(r.results);
        setStatus("done");
        setMessage(r.results.length === 0 ? "Aucune entreprise trouvée." : null);
        combobox.openDropdown();
        // Enter takes the first company without going down to it.
        if (r.results.length > 0) requestAnimationFrame(() => combobox.selectFirstOption());
      } else {
        setResults([]);
        setStatus("failed");
        setMessage(r.message);
        combobox.closeDropdown();
      }
    };
    const timer = setTimeout(() => void run(), DELAY_MS);
    return () => clearTimeout(timer);
    // combobox is a new object on each render; its methods are stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const pick = (siren: string) => {
    const b = results.find((r) => r.siren === siren);
    if (!b) return;
    onPick(b);
    setText("");
    setResults([]);
    setStatus("idle");
    setMessage(`${b.legalName} : champs remplis.`);
    combobox.closeDropdown();
  };

  return (
    <div>
      <Combobox store={combobox} onOptionSubmit={pick}>
        <Combobox.Target>
          <TextInput
            label={label}
            description={description}
            value={text}
            autoComplete="off"
            rightSection={status === "searching" ? <Loader size="xs" /> : null}
            onChange={(e) => {
              const t = e.currentTarget.value;
              setText(t);
              if (t.trim().length < MIN) {
                setResults([]);
                setStatus("idle");
                setMessage(null);
                combobox.closeDropdown();
              }
            }}
            onFocus={() => results.length > 0 && combobox.openDropdown()}
            onBlur={() => combobox.closeDropdown()}
            onKeyDown={(e) => {
              // Enter in a search field never saves the form.
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        </Combobox.Target>
        <Combobox.Dropdown hidden={results.length === 0}>
          <Combobox.Options mah={320} style={{ overflowY: "auto" }}>
            {results.map((b) => (
              <Combobox.Option key={b.siren} value={b.siren}>
                <Group gap="xs" wrap="nowrap" justify="space-between">
                  <div className="min-w-0">
                    <Text size="sm" fw={500} truncate>
                      {b.legalName}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[spacedSiren(b.siren), b.legalForm, b.city].filter(Boolean).join(" — ")}
                    </Text>
                  </div>
                  {b.ceased && (
                    <Badge color="red" variant="light" size="sm">
                      fermée
                    </Badge>
                  )}
                </Group>
              </Combobox.Option>
            ))}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      <Text size="xs" c={status === "failed" ? undefined : "dimmed"} mt={4} role="status" aria-live="polite">
        {message}
      </Text>
    </div>
  );
}
